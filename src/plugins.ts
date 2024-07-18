/* eslint-disable @typescript-eslint/no-unused-vars */
import { AnsiLogger, BLUE, db, er, nf, pl, TimestampFormat, UNDERLINE, UNDERLINEOFF, wr } from 'node-ansi-logger';
import { Matterbridge } from './matterbridge.js';
import { RegisteredPlugin } from './matterbridgeTypes.js';
import { NodeStorage } from 'node-persist-manager';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { MatterbridgePlatform, PlatformConfig } from './matterbridgePlatform.js';
import { exec, ExecException } from 'child_process';

// Default colors
const plg = '\u001B[38;5;33m';
const dev = '\u001B[38;5;79m';
const typ = '\u001B[38;5;207m';

export class Plugins {
  private _plugins = new Map<string, RegisteredPlugin>();
  private nodeContext: NodeStorage;
  private matterbridge: Matterbridge;
  private log: AnsiLogger;

  constructor(matterbridge: Matterbridge) {
    this.matterbridge = matterbridge;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.nodeContext = (matterbridge as any).nodeContext;
    this.log = new AnsiLogger({ logName: 'MatterbridgePluginsManager', logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: matterbridge.debugEnabled });
    this.log.debug('Matterbridge plugin manager starting...');
  }

  get length(): number {
    return this._plugins.size;
  }

  get size(): number {
    return this._plugins.size;
  }

  has(name: string): boolean {
    return this._plugins.has(name);
  }

  get(name: string): RegisteredPlugin | undefined {
    return this._plugins.get(name);
  }

  set(plugin: RegisteredPlugin): RegisteredPlugin {
    this._plugins.set(plugin.name, plugin);
    return plugin;
  }

  clear(): void {
    this._plugins.clear();
  }

  array(): RegisteredPlugin[] {
    return Array.from(this._plugins.values());
  }

  [Symbol.iterator]() {
    return this._plugins.values();
  }

  async loadFromStorage(): Promise<RegisteredPlugin[]> {
    // Load the array from storage and convert it to a map
    const pluginsArray = await this.nodeContext.get<RegisteredPlugin[]>('plugins', []);
    for (const plugin of pluginsArray) this._plugins.set(plugin.name, plugin);
    return pluginsArray;
  }

  async saveToStorage(): Promise<number> {
    // Convert the map to an array
    const plugins: RegisteredPlugin[] = [];
    const pluginArrayFromMap = Array.from(this._plugins.values());
    for (const plugin of pluginArrayFromMap) {
      plugins.push({
        name: plugin.name,
        path: plugin.path,
        type: plugin.type,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        enabled: plugin.enabled,
        qrPairingCode: plugin.qrPairingCode,
        manualPairingCode: plugin.manualPairingCode,
      });
    }
    await this.nodeContext.set<RegisteredPlugin[]>('plugins', plugins);
    this.log.debug(`Saved ${BLUE}${plugins.length}${db} plugins to storage`);
    return plugins.length;
  }

  /**
   * Resolves the name of a plugin by loading and parsing its package.json file.
   * @param pluginPath - The path to the plugin or the path to the plugin's package.json file.
   * @returns The path to the resolved package.json file, or null if the package.json file is not found or does not contain a name.
   */
  async resolve(pluginPath: string): Promise<string | null> {
    if (!pluginPath.endsWith('package.json')) pluginPath = path.join(pluginPath, 'package.json');

    // Resolve the package.json of the plugin
    let packageJsonPath = path.resolve(pluginPath);
    this.log.debug(`Resolving plugin path ${plg}${packageJsonPath}${db}`);

    // Check if the package.json file exists
    try {
      await fs.access(packageJsonPath);
    } catch {
      this.log.debug(`Package.json not found at ${plg}${packageJsonPath}${db}`);
      packageJsonPath = path.join(this.matterbridge.globalModulesDirectory, pluginPath);
      this.log.debug(`Trying at ${plg}${packageJsonPath}${db}`);
    }
    try {
      // Load the package.json of the plugin
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      if (!packageJson.name) {
        this.log.debug(`Package.json name not found at ${packageJsonPath}`);
        return null;
      }
      this.log.debug(`Resolved plugin path ${plg}${pluginPath}${db}: ${packageJsonPath}`);
      return packageJsonPath;
    } catch (err) {
      this.log.error(`Failed to resolve plugin path ${plg}${pluginPath}${er}: ${err}`);
      return null;
    }
  }

  /**
   * Loads and parse the plugin package.json and returns it.
   * @param plugin - The plugin to load the package from.
   * @returns A Promise that resolves to the package.json object or undefined if the package.json could not be loaded.
   */
  async parse(plugin: RegisteredPlugin): Promise<Record<string, string | number | object> | null> {
    this.log.debug(`Parsing package.json of plugin ${plg}${plugin.name}${db}`);
    try {
      const packageJson = JSON.parse(await fs.readFile(plugin.path, 'utf8'));
      if (!plugin.name) this.log.warn(`Plugin ${plg}${plugin.name}${wr} has no name in package.json`);
      if (!plugin.version) this.log.warn(`Plugin ${plg}${plugin.name}${wr} has no version in package.json`);
      plugin.name = packageJson.name || 'Unknown name';
      plugin.version = packageJson.version || '1.0.0';
      plugin.description = packageJson.description || 'Unknown description';
      plugin.author = packageJson.author || 'Unknown author';
      if (!plugin.path) this.log.warn(`Plugin ${plg}${plugin.name}${wr} has no path`);
      if (!plugin.type) this.log.warn(`Plugin ${plg}${plugin.name}${wr} has no type`);
      // await this.saveToStorage();
      return packageJson;
    } catch (err) {
      this.log.error(`Failed to parse package.json of plugin ${plg}${plugin.name}${er}: ${err}`);
      plugin.error = true;
      return null;
    }
  }

  async enable(nameOrPath: string): Promise<RegisteredPlugin | null> {
    if (!nameOrPath || nameOrPath === '') return null;
    if (this._plugins.has(nameOrPath)) {
      const plugin = this._plugins.get(nameOrPath) as RegisteredPlugin;
      plugin.enabled = true;
      this.log.info(`Enabled plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    }
    const packageJsonPath = await this.resolve(nameOrPath);
    if (!packageJsonPath) {
      this.log.error(`Failed to enable plugin ${plg}${nameOrPath}${er}: package.json not found`);
      return null;
    }
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const plugin = this._plugins.get(packageJson.name);
      if (!plugin) {
        this.log.error(`Failed to enable plugin ${plg}${nameOrPath}${er}: plugin not registered`);
        return null;
      }
      plugin.enabled = true;
      this.log.info(`Enabled plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    } catch (err) {
      this.log.error(`Failed to parse package.json of plugin ${plg}${nameOrPath}${er}: ${err}`);
      return null;
    }
  }

  async disable(nameOrPath: string): Promise<RegisteredPlugin | null> {
    if (!nameOrPath || nameOrPath === '') return null;
    if (this._plugins.has(nameOrPath)) {
      const plugin = this._plugins.get(nameOrPath) as RegisteredPlugin;
      plugin.enabled = false;
      this.log.info(`Disabled plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    }
    const packageJsonPath = await this.resolve(nameOrPath);
    if (!packageJsonPath) {
      this.log.error(`Failed to disable plugin ${plg}${nameOrPath}${er}: package.json not found`);
      return null;
    }
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const plugin = this._plugins.get(packageJson.name);
      if (!plugin) {
        this.log.error(`Failed to disable plugin ${plg}${nameOrPath}${er}: plugin not registered`);
        return null;
      }
      plugin.enabled = false;
      this.log.info(`Disabled plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    } catch (err) {
      this.log.error(`Failed to parse package.json of plugin ${plg}${nameOrPath}${er}: ${err}`);
      return null;
    }
  }

  async remove(nameOrPath: string): Promise<RegisteredPlugin | null> {
    if (!nameOrPath || nameOrPath === '') return null;
    if (this._plugins.has(nameOrPath)) {
      const plugin = this._plugins.get(nameOrPath) as RegisteredPlugin;
      this._plugins.delete(nameOrPath);
      this.log.info(`Removed plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    }
    const packageJsonPath = await this.resolve(nameOrPath);
    if (!packageJsonPath) {
      this.log.error(`Failed to remove plugin ${plg}${nameOrPath}${er}: package.json not found`);
      return null;
    }
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const plugin = this._plugins.get(packageJson.name);
      if (!plugin) {
        this.log.error(`Failed to remove plugin ${plg}${nameOrPath}${er}: plugin not registered`);
        return null;
      }
      this._plugins.delete(packageJson.name);
      this.log.info(`Removed plugin ${plg}${plugin.name}${nf}`);
      await this.saveToStorage();
      return plugin;
    } catch (err) {
      this.log.error(`Failed to parse package.json of plugin ${plg}${nameOrPath}${er}: ${err}`);
      return null;
    }
  }

  async add(nameOrPath: string): Promise<RegisteredPlugin | null> {
    if (!nameOrPath || nameOrPath === '') return null;
    const packageJsonPath = await this.resolve(nameOrPath);
    if (!packageJsonPath) {
      this.log.error(`Failed to add plugin ${plg}${nameOrPath}${er}: package.json not found`);
      return null;
    }
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      if (this._plugins.get(packageJson.name)) {
        this.log.error(`Failed to add plugin ${plg}${nameOrPath}${er}: plugin already registered`);
        return null;
      }
      this._plugins.set(packageJson.name, { name: packageJson.name, enabled: true, path: packageJsonPath, type: '', version: packageJson.version, description: packageJson.description, author: packageJson.author });
      this.log.info(`Added plugin ${plg}${packageJson.name}${nf}`);
      await this.saveToStorage();
      const plugin = this._plugins.get(packageJson.name);
      return plugin || null;
    } catch (err) {
      this.log.error(`Failed to parse package.json of plugin ${plg}${nameOrPath}${er}: ${err}`);
      return null;
    }
  }

  async install(name: string): Promise<string> {
    this.log.info(`Installing plugin ${plg}${name}${nf}`);
    return new Promise((resolve, reject) => {
      exec(`npm install -g ${name}`, (error: ExecException | null, stdout: string) => {
        if (error) {
          this.log.error(`Failed to install plugin ${plg}${name}${er}: ${error}`);
          reject(error);
        } else {
          this.log.info(`Installed plugin ${plg}${name}${nf}`);
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Loads a plugin and returns the corresponding MatterbridgePlatform instance.
   * @param plugin - The plugin to load.
   * @param start - Optional flag indicating whether to start the plugin after loading. Default is false.
   * @param message - Optional message to pass to the plugin when starting.
   * @returns A Promise that resolves to the loaded MatterbridgePlatform instance.
   * @throws An error if the plugin is not enabled, already loaded, or fails to load.
   */
  async load(plugin: RegisteredPlugin, start = false, message = ''): Promise<MatterbridgePlatform | undefined> {
    if (!plugin.enabled) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not enabled`);
      return Promise.resolve(undefined);
    }
    if (plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} already loaded`);
      return Promise.resolve(plugin.platform);
    }
    this.log.info(`Loading plugin ${plg}${plugin.name}${nf} type ${typ}${plugin.type}${nf}`);
    try {
      // Load the package.json of the plugin
      const packageJson = JSON.parse(await fs.readFile(plugin.path, 'utf8'));
      // Resolve the main module path relative to package.json
      const pluginEntry = path.resolve(path.dirname(plugin.path), packageJson.main);
      // Dynamically import the plugin
      const pluginUrl = pathToFileURL(pluginEntry);
      this.log.debug(`Importing plugin ${plg}${plugin.name}${db} from ${pluginUrl.href}`);
      const pluginInstance = await import(pluginUrl.href);
      this.log.debug(`Imported plugin ${plg}${plugin.name}${db} from ${pluginUrl.href}`);

      // Call the default export function of the plugin, passing this MatterBridge instance, the log and the config
      if (pluginInstance.default) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config: PlatformConfig = await (this.matterbridge as any).loadPluginConfig(plugin);
        const log = new AnsiLogger({ logName: plugin.description ?? 'No description', logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: (config.debug as boolean) ?? false });
        const platform = pluginInstance.default(this.matterbridge, log, config) as MatterbridgePlatform;
        platform.name = packageJson.name;
        platform.config = config;
        platform.version = packageJson.version;
        plugin.name = packageJson.name;
        plugin.description = packageJson.description ?? 'No description';
        plugin.version = packageJson.version;
        plugin.author = packageJson.author ?? 'Unknown';
        plugin.type = platform.type;
        plugin.platform = platform;
        plugin.loaded = true;
        plugin.registeredDevices = 0;
        plugin.addedDevices = 0;
        plugin.configJson = config;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugin.schemaJson = await (this.matterbridge as any).loadPluginSchema(plugin);

        this.log.info(`Loaded plugin ${plg}${plugin.name}${nf} type ${typ}${platform.type}${db} (entrypoint ${UNDERLINE}${pluginEntry}${UNDERLINEOFF})`);

        if (start) await this.start(plugin, message, false);

        return Promise.resolve(platform);
      } else {
        this.log.error(`Plugin ${plg}${plugin.name}${er} does not provide a default export`);
        plugin.error = true;
      }
    } catch (err) {
      this.log.error(`Failed to load plugin ${plg}${plugin.name}${er}: ${err}`);
      plugin.error = true;
    }
    return Promise.resolve(undefined);
  }

  /**
   * Starts a plugin.
   *
   * @param {RegisteredPlugin} plugin - The plugin to start.
   * @param {string} [message] - Optional message to pass to the plugin's onStart method.
   * @param {boolean} [configure] - Indicates whether to configure the plugin after starting (default false).
   * @returns {Promise<RegisteredPlugin | undefined>} A promise that resolves when the plugin is started successfully, or rejects with an error if starting the plugin fails.
   */
  async start(plugin: RegisteredPlugin, message?: string, configure = false): Promise<RegisteredPlugin | undefined> {
    if (!plugin.loaded) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not loaded`);
      return Promise.resolve(undefined);
    }
    if (!plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} no platform found`);
      return Promise.resolve(undefined);
    }
    if (plugin.started) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} already started`);
      return Promise.resolve(undefined);
    }
    this.log.info(`Starting plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
    try {
      await plugin.platform.onStart(message);
      this.log.info(`Started plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
      plugin.started = true;
      if (configure) await this.configure(plugin);
      return Promise.resolve(plugin);
    } catch (err) {
      plugin.error = true;
      this.log.error(`Failed to start plugin ${plg}${plugin.name}${er}: ${err}`);
    }
    return Promise.resolve(undefined);
  }

  /**
   * Configures a plugin.
   *
   * @param {RegisteredPlugin} plugin - The plugin to configure.
   * @returns {Promise<void>} A promise that resolves when the plugin is configured successfully, or rejects with an error if configuration fails.
   */
  async configure(plugin: RegisteredPlugin): Promise<RegisteredPlugin | undefined> {
    if (!plugin.loaded) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not loaded`);
      return Promise.resolve(undefined);
    }
    if (!plugin.started) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not started`);
      return Promise.resolve(undefined);
    }
    if (!plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} no platform found`);
      return Promise.resolve(undefined);
    }
    if (plugin.configured) {
      this.log.debug(`Plugin ${plg}${plugin.name}${db} already configured`);
      return Promise.resolve(undefined);
    }
    this.log.info(`Configuring plugin ${plg}${plugin.name}${nf} type ${typ}${plugin.type}${nf}`);
    try {
      await plugin.platform.onConfigure();
      this.log.info(`Configured plugin ${plg}${plugin.name}${nf} type ${typ}${plugin.type}${nf}`);
      plugin.configured = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.matterbridge as any).savePluginConfig(plugin);
      return Promise.resolve(plugin);
    } catch (err) {
      plugin.error = true;
      this.log.error(`Failed to configure plugin ${plg}${plugin.name}${er}: ${err}`);
    }
    return Promise.resolve(undefined);
  }

  async shutdown(plugin: RegisteredPlugin, reason?: string, removeAllDevices = false): Promise<RegisteredPlugin | undefined> {
    this.log.debug(`Shutting down plugin ${plg}${plugin.name}${db}`);
    if (!plugin.loaded) {
      this.log.debug(`*Plugin ${plg}${plugin.name}${db} not loaded`);
      return undefined;
    }
    if (!plugin.started) {
      this.log.debug(`*Plugin ${plg}${plugin.name}${db} not started`);
      return undefined;
    }
    if (!plugin.configured) {
      this.log.debug(`*Plugin ${plg}${plugin.name}${db} not configured`);
      return undefined;
    }
    if (!plugin.platform) {
      this.log.debug(`*Plugin ${plg}${plugin.name}${db} no platform found`);
      return undefined;
    }
    this.log.info(`Shutting down plugin ${plg}${plugin.name}${nf}: ${reason}...`);
    try {
      await plugin.platform.onShutdown(reason);
      plugin.locked = undefined;
      plugin.error = undefined;
      plugin.loaded = undefined;
      plugin.started = undefined;
      plugin.configured = undefined;
      plugin.connected = undefined;
      plugin.platform = undefined;
      plugin.registeredDevices = undefined;
      plugin.addedDevices = undefined;
      if (removeAllDevices) {
        this.log.info(`Removing all devices for plugin ${plg}${plugin.name}${nf}: ${reason}...`);
        await this.matterbridge.removeAllBridgedDevices(plugin.name);
      }
      this.log.info(`Shutdown of plugin ${plg}${plugin.name}${nf} completed`);
      return plugin;
    } catch (err) {
      this.log.error(`Failed to shut down plugin ${plg}${plugin.name}${er}: ${err}`);
    }
    return undefined;
  }
}
