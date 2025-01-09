// React
import React, { useEffect, useRef, useState, useCallback, useMemo, createContext } from 'react';

// Local modules
import { debug } from '../App';

/**
 * Websocket message IDs taken from matterbridgeWebsocket.ts
 */
export const WS_ID_LOG = 0;
export const WS_ID_REFRESH_NEEDED = 1;
export const WS_ID_RESTART_NEEDED = 2;

export const WebSocketContext = createContext();

export function WebSocketProvider({ children }) {
  // States
  const [logFilterLevel, setLogFilterLevel] = useState(localStorage.getItem('logFilterLevel')??'info');
  const [logFilterSearch, setLogFilterSearch] = useState(localStorage.getItem('logFilterSearch')??'*');
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [restart, setRestart] = useState(false);

  // Refs
  const listenersRef = useRef([]);
  const wsRef = useRef(null);
  const retryCountRef = useRef(1);
  const uniqueIdRef = useRef(Math.floor(Math.random() * (999999 - 3 + 1)) + 3);
  const pingIntervalRef = useRef(null);
  const offlineTimeoutRef = useRef(null);
  const logFilterLevelRef = useRef(logFilterLevel);
  const logFilterSearchRef = useRef(logFilterSearch);

  // Memos
  const wssHost = useMemo(() => window.location.href.replace(/^http/, 'ws'), []); // Replace "http" or "https" with "ws" or "wss"
  const isIngress = useMemo(() => window.location.href.includes('api/hassio_ingress'), []);

  // Constants
  const maxMessages = 1000;
  const maxRetries = 100;
  const pingIntervalSeconds = 10;
  const offlineTimeoutSeconds = 5;

  // console.log(`WebSocketUse: wssHost: ${wssHost} ssl: ${ssl} logFilterLevel: ${logFilterLevel} logFilterSearch: ${logFilterSearch} messages: ${messages.length} available`);
  
  useEffect(() => {
      logFilterLevelRef.current = logFilterLevel;
  }, [logFilterLevel]);

  useEffect(() => {
      logFilterSearchRef.current = logFilterSearch;
  }, [logFilterSearch]);

  const sendMessage = useCallback((message) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          if(message.id===undefined) message.id = uniqueIdRef.current;
          const msg = JSON.stringify(message);
          wsRef.current.send(msg);
          if(debug) console.log(`WebSocket sent message:`, message);
        } catch (error) {
          // eslint-disable-next-line no-console  
          console.error(`WebSocket error sending message: ${error}`);
        }
      } else {
        console.error(`WebSocket message not sent, WebSocket not connected:`, message);
      }
  }, []);

  const logMessage = useCallback((badge, message) => {
      const badgeSpan = `<span style="background-color: #5c0e91; color: white; padding: 1px 5px; font-size: 12px; border-radius: 3px;">${badge}</span>`;
      setMessages(prevMessages => [...prevMessages, badgeSpan + ' <span style="color: var(--main-log-color);">' + message + '</span>']);
  }, []);

  const setLogFilters = useCallback((level, search) => {
      setLogFilterLevel(level);
      setLogFilterSearch(search);
      logMessage('WebSocket', `Filtering by log level "${level}" and log search "${search}"`);
  }, [logMessage]);

  const addListener = useCallback((listener) => {
    // console.log(`WebSocket addListener:`, listener);
    listenersRef.current = [...listenersRef.current, listener];
    if(debug) console.log(`WebSocket addListener total listeners:`, listenersRef.current.length);
  }, []);

  const removeListener = useCallback((listener) => {
    // console.log(`WebSocket removeListener:`, listener);
    listenersRef.current = listenersRef.current.filter(l => l !== listener);
    if(debug) console.log(`WebSocket removeListener total listeners:`, listenersRef.current.length);
  }, []);

  const connectWebSocket = useCallback(() => {
      if(wssHost === '' || wssHost === null || wssHost === undefined)  return;
      /*
      Direct http: WebSocketUse: window.location.host=localhost:8283 window.location.href=http://localhost:8283/ wssHost=ws://localhost:8283
      Direct https: WebSocketUse: window.location.host=localhost:8443 window.location.href=https://localhost:8443/ wssHost=wss://localhost:8443
      Ingress: WebSocketUse window.location.host: homeassistant.local:8123 window.location.href: http://homeassistant.local:8123/api/hassio_ingress/nD0C1__RqgwrZT_UdHObtcPNN7fCFxCjlmPQfCzVKI8/ Connecting to WebSocket: ws://homeassistant.local:8123/api/hassio_ingress/nD0C1__RqgwrZT_UdHObtcPNN7fCFxCjlmPQfCzVKI8/
      */
      // console.log(`WebSocketUse: window.location.host=${window.location.host} window.location.protocol=${window.location.protocol} window.location.href=${window.location.href} wssHost=${wssHost}`);
      logMessage('WebSocket', `Connecting to WebSocket: ${wssHost}`);
      wsRef.current = new WebSocket(wssHost);

      wsRef.current.onmessage = (event) => {
        if(!online) setOnline(true);
        try {
          const msg = JSON.parse(event.data);
          if(msg.error) {
            console.error(`WebSocket error message:`, msg);
          }
          if(msg.id===undefined) {
            return; // Ignore messages without an ID
          } else if(msg.id===WS_ID_REFRESH_NEEDED) {
            if(debug) console.log(`WebSocket WS_ID_REFRESH_NEEDED message:`, msg, 'listeners:', listenersRef.current.length);
            setRefresh(true);
            listenersRef.current.forEach(listener => listener(msg)); // Notify all listeners
            return;
          } else if(msg.id===WS_ID_RESTART_NEEDED) {
            if(debug) console.log(`WebSocket WS_ID_RESTART_NEEDED message:`, msg, 'listeners:', listenersRef.current.length);
            setRestart(true);
            listenersRef.current.forEach(listener => listener(msg)); // Notify all listeners
            return;
          } else if(msg.id===uniqueIdRef.current && msg.src === 'Matterbridge' && msg.dst === 'Frontend' && msg.response === 'pong') {
            // console.log(`WebSocket Pong message:`, msg, 'listeners:', listenersRef.current.length);
            clearTimeout(offlineTimeoutRef.current);
            listenersRef.current.forEach(listener => listener(msg)); // Notify all listeners
            return;
          } else if(msg.id!==WS_ID_LOG) {
            console.log(`WebSocket message:`, msg, 'listeners:', listenersRef.current.length);
            listenersRef.current.forEach(listener => listener(msg)); // Notify all listeners
            return;
          }
          if(msg.id!==WS_ID_LOG || !msg.level || !msg.time || !msg.name || !msg.message) return;

          // console.log(`WebSocketUse message: ${msg.level} - ${msg.time} - ${msg.name}: ${msg.message}`);
          // console.log(`WebSocketUse logFilterLevel: "${logFilterLevelRef.current}" logFilterSearch: "${logFilterSearchRef.current}"`);
          const normalLevels = ['debug', 'info', 'notice', 'warn', 'error', 'fatal'];
          if(normalLevels.includes(msg.level)) {
              if(logFilterLevelRef.current === 'info' && msg.level === 'debug') return;
              if(logFilterLevelRef.current === 'notice' && (msg.level === 'debug' || msg.level === 'info')) return;
              if(logFilterLevelRef.current === 'warn' && (msg.level === 'debug' || msg.level === 'info' || msg.level === 'notice')) return;
              if(logFilterLevelRef.current === 'error' && (msg.level === 'debug' || msg.level === 'info' || msg.level === 'notice' || msg.level === 'warn')) return;
              if(logFilterLevelRef.current === 'fatal' && (msg.level === 'debug' || msg.level === 'info' || msg.level === 'notice' || msg.level === 'warn' || msg.level === 'error')) return;
          }
          if( logFilterSearchRef.current !== '*' && logFilterSearchRef.current !== '' && !msg.message.toLowerCase().includes(logFilterSearchRef.current.toLowerCase()) && !msg.name.toLowerCase().includes(logFilterSearchRef.current.toLowerCase()) ) return;
          // console.log(`useWebSocket afterfilter: debugLevel: '${debugLevel}'-'${msg.subType}' searchCriteria: '${searchCriteria}'`);

          setMessages(prevMessages => {
              // Create new array with new message
              const timeString = `<span style="color: #505050;">[${msg.time}]</span>`;
              const getsubTypeMessageBgColor = (level) => {
                  switch (level.toLowerCase()) {
                      case 'debug':
                          return 'gray';
                      case 'info':
                          return '#267fb7';
                      case 'notice':
                          return 'green';
                      case 'warn':
                          return '#e9db18';
                      case 'error':
                          return 'red';
                      case 'fatal':    
                          return '#ff0000';
                      case 'spawn':
                          return '#ff00d0';
                      default:
                          return 'lightblue'; 
                  }
              };                
              const getsubTypeMessageColor = (level) => {
                  switch (level.toLowerCase()) {
                      case 'warn':
                          return 'black';
                      default:
                          return 'white'; 
                  }
              };                
              const coloredSubType = `<span style="background-color: ${getsubTypeMessageBgColor(msg.level)}; color: ${getsubTypeMessageColor(msg.level)}; padding: 1px 5px; font-size: 12px; border-radius: 3px;">${msg.level}</span>`;
              const newMessage = `${coloredSubType} ${timeString} <span style="color: #09516d;">[${msg.name}]</span> <span style="color: var(--main-log-color);">${msg.message}</span>`;
              const newMessages = [...prevMessages, newMessage];
              // Check if the new array length exceeds the maximum allowed
              if (newMessages.length > maxMessages) {
                  // Remove the oldest messages to maintain maxMessages count
                  return newMessages.slice(newMessages.length - maxMessages);
              }
              return newMessages;
          });
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`WebSocketUse error parsing message: ${error}`);
        }
      };

      wsRef.current.onopen = () => { 
          logMessage('WebSocket', `Connected to WebSocket: ${wssHost}`);
          setOnline(true);
          retryCountRef.current = 1;
          pingIntervalRef.current = setInterval(() => {
            sendMessage({ id: uniqueIdRef.current, method: "ping", src: "Frontend", dst: "Matterbridge", params: {} });
            clearTimeout(offlineTimeoutRef.current);
            offlineTimeoutRef.current = setTimeout(() => {
              console.error(`WebSocketUse: No pong response received from WebSocket: ${wssHost}`);
              logMessage('WebSocket', `No pong response received from WebSocket: ${wssHost}`);
              setOnline(false);
            }, 1000 * offlineTimeoutSeconds);
          }, 1000 * pingIntervalSeconds);
      };

      wsRef.current.onclose = () => { 
          console.error(`WebSocketUse: Disconnected from WebSocket: ${wssHost}`);
          logMessage('WebSocket', `Disconnected from WebSocket: ${wssHost}`);
          setOnline(false);
          clearTimeout(offlineTimeoutRef.current);
          clearInterval(pingIntervalRef.current);
          logMessage('WebSocket', `Reconnecting (attempt ${retryCountRef.current} of ${maxRetries}) to WebSocket${isIngress?' (Ingress)':''}: ${wssHost}`);
          if( retryCountRef.current < maxRetries ) setTimeout(attemptReconnect, 1000 * retryCountRef.current);
          else logMessage('WebSocket', `Reconnect attempts exceeded limit of ${maxRetries} retries, refresh the page to reconnect to: ${wssHost}`);
          retryCountRef.current = retryCountRef.current + 1;
      };

      wsRef.current.onerror = (error) => {
          console.error(`WebSocketUse: WebSocket error connecting to ${wssHost}:`, error);
          logMessage('WebSocket', `WebSocket error connecting to ${wssHost}`);
      };
  }, [wssHost]);

  /*
          if( retryCountRef.current === 1 ) attemptReconnect();
          else if( retryCountRef.current < maxRetries ) setTimeout(attemptReconnect, 1000 * retryCountRef.current);
          else logMessage('WebSocket', `Reconnect attempts exceeded limit of ${maxRetries} retries, refresh the page to reconnect to: ${wssHost}`);

  */
  const attemptReconnect = useCallback(() => {
      if(debug) console.log(`WebSocket attemptReconnect ${retryCountRef.current}/${maxRetries} to:`, wssHost);
      connectWebSocket();
  }, [connectWebSocket]);

  useEffect(() => {
      connectWebSocket();
      return () => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.close();
          }
      };
  }, [connectWebSocket]);
    
  return (
    <WebSocketContext.Provider value={{ messages, setMessages, sendMessage, logMessage, setLogFilters, online, refresh, restart, addListener, removeListener }}>
      {children}
    </WebSocketContext.Provider>
  );
}