import { PureCloudWebrtcSdk } from './client';
import StreamingClient from 'purecloud-streaming-client';
import { log } from './logging';
import { LogLevels } from './types/enums';
import { SessionManager } from './sessions/session-manager';

/**
 * Establish the connection with the streaming client.
 *  Must be called after construction _before_ the SDK is used.
 * @param this must be called with a PureCloudWebrtcSdk as `this`
 */
export async function setupStreamingClient (this: PureCloudWebrtcSdk): Promise<void> {
  if (this._streamingConnection) {
    this.logger.warn('Existing streaming connection detected. Disconnecting and creating a new connection.');
    await this._streamingConnection.disconnect();
  }

  const connectionOptions: any = {
    signalIceConnected: true,
    iceTransportPolicy: this._config.iceTransportPolicy,
    host: this._config.wsHost || `wss://streaming.${this._config.environment}`,
    apiHost: this._config.environment,
    logger: this.logger
  };

  if (this._personDetails) {
    connectionOptions.jid = this._personDetails.chat.jabberId;
  }

  if (this._config.accessToken) {
    connectionOptions.authToken = this._config.accessToken;
  }

  if (this._customerData && this._customerData.jwt) {
    connectionOptions.jwt = this._customerData.jwt;
  }

  log.call(this, LogLevels.debug, 'Streaming client WebSocket connection options', connectionOptions);
  this._hasConnected = false;

  const connection = new StreamingClient(connectionOptions);
  this._streamingConnection = connection;

  await connection.connect();
  this.emit('connected', { reconnect: this._hasConnected });
  log.call(this, LogLevels.info, 'PureCloud streaming client connected', { reconnect: this._hasConnected });
  this._hasConnected = true;
  // refresh turn servers every 6 hours
  this._refreshTurnServersInterval = setInterval(this._refreshTurnServers.bind(this), 6 * 60 * 60 * 1000);
  await connection.webrtcSessions.refreshIceServers();
  log.call(this, LogLevels.info, 'PureCloud streaming client ready for use');
}

/**
 * Set up proxy for streaming client events
 * @param this must be called with a PureCloudWebrtcSdk as `this`
 */
export function proxyStreamingClientEvents (this: PureCloudWebrtcSdk) {
  this.sessionManager = new SessionManager(this);
  this.sessionManager.initSessionHandlers();

  // webrtc events
  const on = this._streamingConnection.webrtcSessions.on.bind(this._streamingConnection);
  on('requestIncomingRtcSession', this.sessionManager.onPropose.bind(this.sessionManager));
  on('incomingRtcSession', this.sessionManager.onSessionInit.bind(this.sessionManager));
  on('rtcSessionError', this.emit.bind(this, 'error'));
  on('cancelIncomingRtcSession', (session: any) => this.emit('cancelPendingSession', session));
  on('handledIncomingRtcSession', (session: any) => this.emit('handledPendingSession', session));
  on('traceRtcSession', this.emit.bind(this, 'trace'));

  // other events
  this._streamingConnection.on('error', this.emit.bind(this, 'error'));
  this._streamingConnection.on('disconnected', () => this.emit('disconnected', 'Streaming API connection disconnected'));
}