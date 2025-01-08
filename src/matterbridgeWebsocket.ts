/**
 * This file contains the function matterbridgeMessageHandler.
 *
 * @file matterbridgeWebsocket.ts
 * @author Luca Liguori
 * @date 2024-10-16
 * @version 1.0.0
 *
 * Copyright 2024, 2025, 2026 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. *
 */

// Matterbridge
import { Matterbridge } from './matterbridge.js';
import { isValidNumber, isValidObject, isValidString } from './utils/utils.js';

// AnsiLogger module
import { debugStringify, stringify } from 'node-ansi-logger';

// Package modules
import WebSocket from 'ws';

// @matter
import { EndpointServer, Logger, Endpoint as EndpointNode } from '@matter/main';
import { BasicInformationCluster, BridgedDeviceBasicInformationCluster } from '@matter/main/clusters';
import { ApiClusters, ApiDevices } from './matterbridgeTypes.js';
import { MatterbridgeDevice } from './matterbridgeDevice.js';

/**
 * Websocket message ID for logging.
 * @constant {number}
 */
export const WS_ID_LOG = 0;

/**
 * Websocket message ID indicating a refresh is needed.
 * @constant {number}
 */
export const WS_ID_REFRESH_NEEDED = 1;

/**
 * Websocket message ID indicating a restart is needed.
 * @constant {number}
 */
export const WS_ID_RESTART_NEEDED = 2;

/**
 * Handles incoming websocket messages for the Matterbridge.
 *
 * @param {Matterbridge} this - The Matterbridge instance.
 * @param {WebSocket} client - The websocket client that sent the message.
 * @param {WebSocket.RawData} message - The raw data of the message received from the client.
 * @returns {Promise<void>} A promise that resolves when the message has been handled.
 */
export async function wsMessageHandler(this: Matterbridge, client: WebSocket, message: WebSocket.RawData): Promise<void> {
  let data: { id: number; dst: string; src: string; method: string; params: Record<string, string | number | boolean> };
  try {
    data = JSON.parse(message.toString());
    if (!isValidNumber(data.id) || !isValidString(data.dst) || !isValidString(data.src) || !isValidString(data.method) || !isValidObject(data.params) || data.dst !== 'Matterbridge') {
      this.log.error(`Invalid message from websocket client: ${debugStringify(data)}`);
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Invalid message' }));
      return;
    }
    this.log.debug(`Received message from websocket client: ${debugStringify(data)}`);

    if (data.method === 'ping') {
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response: 'pong' }));
      return;
    } else if (data.method === '/api/login') {
      if (!this.nodeContext) {
        this.log.error('Login nodeContext not found');
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Internal error: nodeContext not found' }));
        return;
      }
      const storedPassword = await this.nodeContext.get('password', '');
      if (storedPassword === '' || storedPassword === data.params.password) {
        this.log.debug('Login password valid');
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response: { valid: true } }));
        return;
      } else {
        this.log.debug('Error wrong password');
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong password' }));
        return;
      }
    } else if (data.method === '/api/install') {
      if (!isValidString(data.params.packageName, 10)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter packageName in /api/install' }));
        return;
      }
      this.spawnCommand('npm', ['install', '-g', data.params.packageName, '--omit=dev', '--verbose'])
        .then((response) => {
          client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response }));
        })
        .catch((error) => {
          client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: error instanceof Error ? error.message : error }));
        });
      return;
    } else if (data.method === '/api/uninstall') {
      if (!isValidString(data.params.packageName, 10)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter packageName in /api/uninstall' }));
        return;
      }
      this.spawnCommand('npm', ['uninstall', '-g', data.params.packageName, '--verbose'])
        .then((response) => {
          client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response }));
        })
        .catch((error) => {
          client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: error instanceof Error ? error.message : error }));
        });
      return;
    } else if (data.method === '/api/restart') {
      await this.restartProcess();
      return;
    } else if (data.method === '/api/shutdown') {
      await this.shutdownProcess();
      return;
    } else if (data.method === '/api/settings') {
      this.matterbridgeInformation.bridgeMode = this.bridgeMode;
      this.matterbridgeInformation.restartMode = this.restartMode;
      this.matterbridgeInformation.loggerLevel = this.log.logLevel;
      this.matterbridgeInformation.matterLoggerLevel = Logger.defaultLogLevel;
      this.matterbridgeInformation.mattermdnsinterface = (await this.nodeContext?.get<string>('mattermdnsinterface', '')) || '';
      this.matterbridgeInformation.matteripv4address = (await this.nodeContext?.get<string>('matteripv4address', '')) || '';
      this.matterbridgeInformation.matteripv6address = (await this.nodeContext?.get<string>('matteripv6address', '')) || '';
      this.matterbridgeInformation.matterPort = (await this.nodeContext?.get<number>('matterport', 5540)) ?? 5540;
      this.matterbridgeInformation.matterDiscriminator = await this.nodeContext?.get<number>('matterdiscriminator');
      this.matterbridgeInformation.matterPasscode = await this.nodeContext?.get<number>('matterpasscode');
      this.matterbridgeInformation.matterbridgePaired = this.matterbridgePaired;
      this.matterbridgeInformation.matterbridgeConnected = this.matterbridgeConnected;
      this.matterbridgeInformation.matterbridgeQrPairingCode = this.matterbridgeQrPairingCode;
      this.matterbridgeInformation.matterbridgeManualPairingCode = this.matterbridgeManualPairingCode;
      this.matterbridgeInformation.matterbridgeFabricInformations = this.matterbridgeFabricInformations;
      this.matterbridgeInformation.matterbridgeSessionInformations = Array.from(this.matterbridgeSessionInformations.values());
      this.matterbridgeInformation.profile = this.profile;
      const response = { systemInformation: this.systemInformation, matterbridgeInformation: this.matterbridgeInformation };
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response }));
      return;
    } else if (data.method === '/api/plugins') {
      const response = await this.getBaseRegisteredPlugins();
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response }));
      return;
    } else if (data.method === '/api/devices') {
      const devices: ApiDevices[] = [];
      this.devices.forEach(async (device) => {
        if (data.params.pluginName && data.params.pluginName !== device.plugin) return;
        let name = device.getClusterServer(BasicInformationCluster)?.attributes.nodeLabel?.getLocal();
        if (!name) name = device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.nodeLabel?.getLocal() ?? 'Unknown';
        let serial = device.getClusterServer(BasicInformationCluster)?.attributes.serialNumber?.getLocal();
        if (!serial) serial = device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.serialNumber?.getLocal() ?? 'Unknown';
        let productUrl = device.getClusterServer(BasicInformationCluster)?.attributes.productUrl?.getLocal();
        if (!productUrl) productUrl = device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.productUrl?.getLocal() ?? 'Unknown';
        let uniqueId = device.getClusterServer(BasicInformationCluster)?.attributes.uniqueId?.getLocal();
        if (!uniqueId) uniqueId = device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.uniqueId?.getLocal() ?? 'Unknown';
        const cluster = this.getClusterTextFromDevice(device);
        devices.push({
          pluginName: device.plugin ?? 'Unknown',
          type: device.name + ' (0x' + device.deviceType.toString(16).padStart(4, '0') + ')',
          endpoint: device.number,
          name,
          serial,
          productUrl,
          configUrl: device.configUrl,
          uniqueId,
          cluster: cluster,
        });
      });
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, response: devices }));
      return;
    } else if (data.method === '/api/clusters') {
      if (!isValidString(data.params.plugin, 10)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter plugin in /api/clusters' }));
        return;
      }
      if (!isValidNumber(data.params.endpoint, 1)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter endpoint in /api/clusters' }));
        return;
      }

      const clusters: ApiClusters[] = [];
      let deviceName = '';
      let serialNumber = '';
      let deviceTypes: number[] = [];

      this.devices.forEach(async (device) => {
        if (data.params.plugin !== device.plugin) return;
        if (data.params.endpoint !== device.number) return;
        deviceName = device.deviceName ?? 'Unknown';
        serialNumber = device.serialNumber ?? 'Unknown';
        deviceTypes = [];

        if (this.edge) device = EndpointServer.forEndpoint(device as unknown as EndpointNode) as unknown as MatterbridgeDevice;
        const clusterServers = device.getAllClusterServers();
        clusterServers.forEach((clusterServer) => {
          Object.entries(clusterServer.attributes).forEach(([key, value]) => {
            if (clusterServer.name === 'EveHistory') return;
            if (clusterServer.name === 'Descriptor' && key === 'deviceTypeList') {
              (value.getLocal() as { deviceType: number; revision: number }[]).forEach((deviceType) => {
                deviceTypes.push(deviceType.deviceType);
              });
            }
            let attributeValue;
            let attributeLocalValue;
            try {
              if (typeof value.getLocal() === 'object') attributeValue = stringify(value.getLocal());
              else attributeValue = value.getLocal().toString();
              attributeLocalValue = value.getLocal();
            } catch (error) {
              attributeValue = 'Fabric-Scoped';
              attributeLocalValue = 'Fabric-Scoped';
              this.log.debug(`GetLocal value ${error} in clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute: ${key}(${value.id})`);
            }
            clusters.push({
              endpoint: device.number ? device.number.toString() : '...',
              id: 'main',
              deviceTypes,
              clusterName: clusterServer.name,
              clusterId: '0x' + clusterServer.id.toString(16).padStart(2, '0'),
              attributeName: key,
              attributeId: '0x' + value.id.toString(16).padStart(2, '0'),
              attributeValue,
              attributeLocalValue,
            });
          });
        });
        device.getChildEndpoints().forEach((childEndpoint) => {
          deviceTypes = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const name = this.edge ? (childEndpoint as any).endpoint?.id : childEndpoint.uniqueStorageKey;
          const clusterServers = childEndpoint.getAllClusterServers();
          clusterServers.forEach((clusterServer) => {
            Object.entries(clusterServer.attributes).forEach(([key, value]) => {
              if (clusterServer.name === 'EveHistory') return;
              if (clusterServer.name === 'Descriptor' && key === 'deviceTypeList') {
                (value.getLocal() as { deviceType: number; revision: number }[]).forEach((deviceType) => {
                  deviceTypes.push(deviceType.deviceType);
                });
              }
              let attributeValue;
              let attributeLocalValue;
              try {
                if (typeof value.getLocal() === 'object') attributeValue = stringify(value.getLocal());
                else attributeValue = value.getLocal().toString();
                attributeLocalValue = value.getLocal();
              } catch (error) {
                attributeValue = 'Fabric-Scoped';
                attributeLocalValue = 'Fabric-Scoped';
                this.log.debug(`GetLocal error ${error} in clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute: ${key}(${value.id})`);
              }
              clusters.push({
                endpoint: childEndpoint.number ? childEndpoint.number.toString() : '...',
                id: name,
                deviceTypes,
                clusterName: clusterServer.name,
                clusterId: '0x' + clusterServer.id.toString(16).padStart(2, '0'),
                attributeName: key,
                attributeId: '0x' + value.id.toString(16).padStart(2, '0'),
                attributeValue,
                attributeLocalValue,
              });
            });
          });
        });
      });
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, plugin: data.params.plugin, deviceName, serialNumber, endpoint: data.params.endpoint, deviceTypes, response: clusters }));
      return;
    } else if (data.method === '/api/select') {
      if (!isValidString(data.params.plugin, 10)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter plugin in /api/select' }));
        return;
      }
      const plugin = this.plugins.get(data.params.plugin);
      if (!plugin) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Plugin not found in /api/select' }));
        return;
      }
      const selectDeviceValues = plugin.platform?.selectDevice ? Array.from(plugin.platform.selectDevice.values()).sort((keyA, keyB) => keyA.name.localeCompare(keyB.name)) : [];
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, plugin: data.params.plugin, response: selectDeviceValues }));
      return;
    } else if (data.method === '/api/select/entities') {
      if (!isValidString(data.params.plugin, 10)) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Wrong parameter plugin in /api/select/entities' }));
        return;
      }
      const plugin = this.plugins.get(data.params.plugin);
      if (!plugin) {
        client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Plugin not found in /api/select/entities' }));
        return;
      }
      const selectEntityValues = plugin.platform?.selectDevice ? Array.from(plugin.platform.selectEntity.values()).sort((keyA, keyB) => keyA.name.localeCompare(keyB.name)) : [];
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, plugin: data.params.plugin, response: selectEntityValues }));
      return;
    } else {
      this.log.error(`Invalid method from websocket client: ${debugStringify(data)}`);
      client.send(JSON.stringify({ id: data.id, method: data.method, src: 'Matterbridge', dst: data.src, error: 'Invalid method' }));
      return;
    }
  } catch (error) {
    this.log.error(`Error parsing message from websocket client:`, error instanceof Error ? error.message : error);
    return;
  }
}
