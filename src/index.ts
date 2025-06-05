import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { deprecate } from 'util';

// Error code definitions
enum DPSN_ERROR_CODES {
  CONNECTION_ERROR = 400,
  UNAUTHORIZED = 401,
  PUBLISH_ERROR = 402,

  INITIALIZATION_FAILED = 403,
  CLIENT_NOT_INITIALIZED = 404,
  CLIENT_NOT_CONNECTED = 405,

  SUBSCRIBE_ERROR = 406,
  SUBSCRIBE_NO_GRANT = 407,
  SUBSCRIBE_SETUP_ERROR = 408,

  DISCONNECT_ERROR = 409,
  INVALID_PRIVATE_KEY = 411,
  ETHERS_ERROR = 412,
  MQTT_ERROR = 413,
}

/**
 * Standardized error class for DPSN client
 * @property {string} code - Error code with DPSN_ prefix
 * @property {string} [status] - Connection status when applicable
 */
class DPSNError extends Error {
  code: DPSN_ERROR_CODES;
  status?: 'connected' | 'disconnected';

  constructor(options: {
    code: DPSN_ERROR_CODES;
    message: string;
    status?: 'connected' | 'disconnected';
    name?: string;
  }) {
    super(options.message);
    this.code = options.code;
    this.status = options.status;
    this.name = options.name || '';

    // Remove stack trace for cleaner error objects when emitted
    this.stack = undefined;
  }

  /**
   * Returns a clean object representation of the error without stack traces
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      name: this.name,
    };
  }
}

/**
 * Validate private key format using ethers.js
 * @param privateKey The private key to validate
 * @throws DPSNError if the private key is invalid
 */
function validateAccessToken(privateKey: string): void {
  try {
    new ethers.Wallet(privateKey);
  } catch (error) {
    throw new DPSNError({
      code: DPSN_ERROR_CODES.INVALID_PRIVATE_KEY,
      message: `Invalid DPSN accesstoken key: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      status: 'disconnected',
    });
  }
}

interface MqttPublishOptions extends mqtt.IClientPublishOptions {
  properties: {
    userProperties: {
      signature: string[];
    };
  };
}

interface InitOptions {
  connectTimeout?: number; // Connection timeout in milliseconds
  retryOptions?: {
    maxRetries?: number; // Maximum number of retry attempts
    initialDelay?: number; // Initial delay between retries in milliseconds
    maxDelay?: number; // Maximum delay between retries in milliseconds
    exponentialBackoff?: boolean; // Whether to use exponential backoff
  };
}

/**
 * Success event types for the DPSN client
 */
export type DpsnEventType =
  | 'connect'
  | 'subscription'
  | 'publish'
  | 'message'
  | 'disconnect'
  | 'error';

/**
 * Success event data structure for the DPSN client
 */
export type DpsnEventData = {
  connect: string;
  subscription: { topic: string; qos: number };
  publish: { topic: string; messageId?: number };
  disconnect: void;
  error: Error | DPSNError;
};

/**
 * DPSN MQTT library for managing topic subscriptions and publications
 */
export class DpsnClient extends EventEmitter {
  private wallet: ethers.Wallet;
  private walletAddress: string;
  private password?: string;
  public dpsnBroker?: MqttClient;
  public dpsnUrl: string;
  private connected: boolean = false;
  private initializing: Promise<MqttClient> | null = null;

  private topicCallbacks = new Map<string, (message: any) => void>();

  constructor(dpsnUrl: string, dpsn_accestoken: string, ssl?: boolean) {
    super();
    try {
      this.dpsnUrl = dpsnUrl;
      validateAccessToken(dpsn_accestoken);

      this.wallet = new ethers.Wallet(dpsn_accestoken);

      this.walletAddress = this.wallet.address;

      if (ssl == true) {
        this.dpsnUrl =
          'mqtts://' + this.dpsnUrl.replace(/^(mqtt|mqtts):\/\//, '');
      } else if (ssl == false) {
        this.dpsnUrl =
          'mqtt://' + this.dpsnUrl.replace(/^(mqtt|mqtts):\/\//, '');
      }
    } catch (error) {
      // If it's already a DPSNError (like INVALID_PRIVATE_KEY), just rethrow it
      if (error instanceof DPSNError) {
        throw error;
      }
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.INITIALIZATION_FAILED,
        message: `Client initialization failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        status: 'disconnected',
      });
      throw dpsnError;
    }
  }

  /**
   * Override the EventEmitter's on method to handle both standard events and DPSN event types
   * @param event The event name or DPSN event type
   * @param listener The callback function
   * @returns this instance for method chaining
   */
  on(
    event: string | symbol | DpsnEventType,
    listener: (...args: any[]) => void
  ): this {
    // Check if the event is a DPSN event type
    if (
      typeof event === 'string' &&
      ['connect', 'subscription', 'publish', 'error', 'disconnect'].includes(
        event as string
      ) &&
      !event.includes('_success')
    ) {
      // Handle DPSN event types
      const eventType = event as DpsnEventType;
      switch (eventType) {
        case 'connect':
          return super.on('connect', listener as (data: string) => void);
        case 'subscription':
          return super.on(
            'subscribe',
            listener as (data: { topic: string; qos: number }) => void
          );
        case 'publish':
          return super.on(
            'publish_success',
            listener as (data: { topic: string; messageId?: number }) => void
          );
        case 'error':
          return super.on(
            'error',
            listener as (error: Error | DPSNError) => void
          );
        case 'disconnect':
          return super.on(
            'disconnect_success',
            listener as (data: void) => void
          );
        default:
          return super.on(event, listener);
      }
    }

    // For standard EventEmitter events, use the parent implementation
    return super.on(event, listener);
  }

  /**
   * Register a callback for connection events
   * @deprecated Use on('connect', callback) or the EventEmitter pattern
   * @param callback Function to call when connection is established
   */
  onConnect(callback: (message: string) => void) {
    this.on('connect', callback);
  }

  /**
   * Register a callback for all error events
   * @deprecated Use on('error', callback) or the EventEmitter pattern
   * @param callback Function to call when any error occurs
   */
  onError(callback: (error: Error | DPSNError) => void): void {
    // Use a wrapper to ensure we don't expose stack traces
    this.on('error', (error) => {
      // For DPSNError, we already handle stack trace removal in the class
      // For other errors, create a clean version
      if (!(error instanceof DPSNError)) {
        const cleanError = {
          message: error.message,
          name: error.name,
        };
        callback(cleanError as Error);
      } else {
        callback(error);
      }
    });
  }

  private async connectWithRetry(
    mqttOptions: IClientOptions,
    retryOptions?: InitOptions['retryOptions']
  ): Promise<void> {
    const maxRetries = retryOptions?.maxRetries ?? 3;
    const initialDelay = retryOptions?.initialDelay ?? 1000;
    const maxDelay = retryOptions?.maxDelay ?? 10000;
    const useExponential = retryOptions?.exponentialBackoff ?? true;

    const attemptConnect = async (retryCount: number = 0): Promise<void> => {
      try {
        return await new Promise<void>((resolve, reject) => {
          this.dpsnBroker = mqtt.connect(this.dpsnUrl, mqttOptions);

          if (!this.dpsnBroker) {
            throw new Error('Dpsn client initialization failed');
          }

          const connectionTimeout = setTimeout(() => {
            this.dpsnBroker?.end(true);
            reject(
              new Error(
                `Connection timeout after ${mqttOptions.connectTimeout}ms`
              )
            );
          }, mqttOptions.connectTimeout);

          this.dpsnBroker.on('error', (error) => {
            this.connected = false;
            clearTimeout(connectionTimeout);
            const dpsnError = new DPSNError({
              code: DPSN_ERROR_CODES.CONNECTION_ERROR,
              message: `DPSN connection failed: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
              status: 'disconnected',
            });
            this.emit('error', dpsnError);
            reject(dpsnError);
          });

          this.dpsnBroker.on('connect', () => {
            clearTimeout(connectionTimeout);
            this.connected = true;
            this.emit('connect', '[CONNECTION ESTABLISHED]');
            resolve();
          });
        });
      } catch (error) {
        if (retryCount < maxRetries) {
          const delay = useExponential
            ? Math.min(initialDelay * Math.pow(2, retryCount), maxDelay)
            : initialDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return attemptConnect(retryCount + 1);
        }
        throw error;
      }
    };

    return attemptConnect();
  }

  /**
   * Initialize the DPSN MQTT client and connect to the DPSN broker
   * @param options - Optional configuration options
   * @param options.connectTimeout - Connection timeout in milliseconds (default 5000)
   * @param options.retryOptions - Retry options
   * @param options.retryOptions.maxRetries - Maximum number of retries (default Infinity)
   * @returns MqttClient - The initialized MQTT client instance
   * @param options.retryOptions.initialDelay - Initial delay between retries in milliseconds (default 1000)
   * @param options.retryOptions.maxDelay - Maximum delay between retries in milliseconds (default 30000)
   * @param options.retryOptions.exponentialBackoff - Use exponential backoff for retries (default true)
   * @returns Promise that resolves when the MQTT client is connected
   */

  /**
   * Ensures the client is initialized before performing operations
   * @param options - Optional initialization options
   * @returns Promise that resolves to the MQTT client
   */
  private async ensureInitialized(
    options: InitOptions = {}
  ): Promise<MqttClient> {
    if (this.dpsnBroker && this.connected) {
      return this.dpsnBroker;
    }

    if (!this.initializing) {
      this.initializing = this.init(options);
    }

    return this.initializing;
  }

  async init(options: InitOptions = {}): Promise<MqttClient> {
    try {
      try {
        const signature = await this.wallet.signMessage('testing');
        this.password = signature;
      } catch (error) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.CONNECTION_ERROR,
          message: 'Failed to sign message',
          status: 'disconnected',
        });
        this.emit('error', dpsnError);
        throw dpsnError;
      }

      const mqttOptions: IClientOptions = {
        username: this.walletAddress,
        password: this.password,
        protocolVersion: 5,
        connectTimeout: options.connectTimeout ?? 5000,
        clean: true,
      };

      await this.connectWithRetry(mqttOptions, options.retryOptions);

      this.dpsnBroker!.on('error', (error) => {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.MQTT_ERROR,
          message:
            error instanceof Error ? error.message : 'Unknown MQTT error',
          status: 'disconnected',
        });
        this.emit('error', dpsnError);
      });

      this.dpsnBroker!.on(
        'message',
        (
          receivedTopic: string,
          payload: Buffer,
          packet: mqtt.IPublishPacket
        ) => {
          let data: any;
          try {
            data = JSON.parse(payload.toString());
          } catch {
            data = payload.toString();
          }
          const callback = this.topicCallbacks.get(receivedTopic);
          if (callback) callback(data);
        }
      );

      this.dpsnBroker!.on('close', () => {
        this.connected = false;
      });

      this.dpsnBroker!.on('disconnect', () => {
        this.connected = false;
      });

      this.dpsnBroker!.on('offline', () => {
        this.connected = false;
      });

      return this.dpsnBroker!;
    } catch (error) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CONNECTION_ERROR,
        message: `Failed to connect: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        status: 'disconnected',
      });
      this.emit('error', dpsnError);
      throw dpsnError;
    }
  }

  /**
   * Publish a message to a DPSN MQTT topic with signature
   * @param topic - The topic to publish to (must be a hex string)
   * @param message - The message to publish (will be JSON stringified)
   * @param options - Optional DPSN MQTT publish options (QoS, retain, etc.)
   * @returns Promise that resolves when publish is successful
   * @throws DPSNError if DPSN MQTT client is not initialized, topic is invalid, or publish fails
   */
  async publish(
    topic: string,
    message: any,
    options: Partial<mqtt.IClientPublishOptions> = { qos: 1, retain: false }
  ): Promise<void> {
    // Ensure client is initialized before publishing
    await this.ensureInitialized();

    if (!this.dpsnBroker) {
      throw new Error(
        '❌ DPSN MQTT client not initialized. Initialization failed.'
      );
    }

    var parentTopic = topic.split('/')[0];
    var hex = true;
    if (!/^0x[0-9a-fA-F]+$/.test(parentTopic)) {
      hex = false;
      parentTopic = ethers.keccak256(ethers.toUtf8Bytes(parentTopic));
    }

    try {
      const signature = await this.wallet.signMessage(
        hex ? ethers.toBeArray(parentTopic) : ethers.getBytes(parentTopic)
      );
      const publishOptions: MqttPublishOptions = {
        ...options,
        properties: {
          userProperties: {
            signature: [signature],
          },
        },
      };

      return new Promise((resolve, reject) => {
        this.dpsnBroker!.publish(
          topic,
          JSON.stringify(message),
          publishOptions,
          (error, packet) => {
            if (error) {
              const dpsnError = new DPSNError({
                code: DPSN_ERROR_CODES.PUBLISH_ERROR,
                message: error.message || 'Failed to publish message',
                status: 'disconnected',
              });
              this.emit('error', dpsnError);
              return reject(dpsnError);
            }

            // Emit success event when publishing succeeds
            this.emit('publish_success', {
              topic,
              messageId: packet?.messageId,
            });

            resolve();
          }
        );
      });
    } catch (error) {
      console.error(
        `❌ Error while preparing message for DPSN topic '${topic}':`,
        error
      );
      throw error;
    }
  }

  /**
   * Subscribe to a DPSN MQTT topic and handle incoming messages
   * @param topic - The topic to subscribe to
   * @param callback - Callback function that will be called with received messages
   * @param options - Optional DPSN MQTT subscription options
   * @returns Promise that resolves when subscription is successful
   * @throws DPSNError if DPSN MQTT client is not initialized or subscription fails
   */
  async subscribe(
    topic: string,
    callback: (message: any) => void,
    options: mqtt.IClientSubscribeOptions = { qos: 1 }
  ): Promise<void> {
    try {
      await this.ensureInitialized();
    } catch (error) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.INITIALIZATION_FAILED,
        message: `Failed to initialize MQTT client: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        status: 'disconnected',
      });
      throw dpsnError;
    }

    if (!this.dpsnBroker) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CLIENT_NOT_INITIALIZED,
        message:
          'Cannot subscribe: DPSN MQTT client not initialized. Initialization failed.',
        status: 'disconnected',
      });
      throw dpsnError;
    }

    if (!this.connected) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CLIENT_NOT_CONNECTED,
        message:
          'Cannot subscribe: DPSN MQTT client is not connected. Please check your connection.',
        status: 'disconnected',
      });
      throw dpsnError;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.dpsnBroker!.subscribe(topic, options, (error, granted) => {
          if (error) {
            const dpsnError = new DPSNError({
              code: DPSN_ERROR_CODES.SUBSCRIBE_ERROR,
              message: `Failed to subscribe to DPSN topic '${topic}': ${error.message}`,
            });
            // Only reject the promise, don't emit the error event
            reject(dpsnError);
            return;
          }

          if (!granted || granted.length === 0) {
            const dpsnError = new DPSNError({
              code: DPSN_ERROR_CODES.SUBSCRIBE_NO_GRANT,
              message: `No subscription granted for DPSN topic '${topic}'`,
            });
            reject(dpsnError);
            return;
          }

          const grantedQoS = granted[0].qos;
          this.emit('subscribe', { topic, qos: grantedQoS });
          resolve();
        });
      });
    } catch (error) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.SUBSCRIBE_SETUP_ERROR,
        message: `Failed to set up subscription for DPSN topic '${topic}': ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        status: 'disconnected',
      });
      throw dpsnError;
    }
    this.topicCallbacks.set(topic, callback);
  }

  /**
   * Unsubscribe from a DPSN MQTT topic
   * @param topic - The topic to unsubscribe from
   * @returns Promise that resolves when unsubscription is successful
   * @throws DPSNError if DPSN MQTT client is not initialized or unsubscription fails
   */
  async unsubscribe(
    topic: string
  ): Promise<{ topic: string; message: string }> {
    if (!this.dpsnBroker) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CLIENT_NOT_INITIALIZED,
        message: 'Cannot unsubscribe: DPSN MQTT client not initialized.',
        status: 'disconnected',
      });
      throw dpsnError;
    }
    if (!this.connected) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CLIENT_NOT_CONNECTED,
        message: 'Cannot unsubscribe: DPSN MQTT client is not connected',
        status: 'disconnected',
      });
      throw dpsnError;
    }

    return new Promise<{ topic: string; message: string }>(
      (resolve, reject) => {
        this.dpsnBroker!.unsubscribe(topic, (error) => {
          if (error) {
            const dpsnError = new DPSNError({
              code: DPSN_ERROR_CODES.SUBSCRIBE_ERROR,
              message: `Failed to unsubscribe from DPSN topic '${topic}:${error.message}'`,
              status: 'connected',
            });
            reject(dpsnError);
            return;
          }
          resolve({
            topic: topic,
            message: 'unsubscribed',
          });
        });
      }
    );
  }

  /**
   * Disconnects from the MQTT broker and cleans up resources
   * @returns Promise that resolves when disconnection is complete
   * @throws Error if MQTT client is not initialized or disconnection fails
   */
  async disconnect(): Promise<void> {
    if (!this.dpsnBroker) {
      const dpsnError = new DPSNError({
        code: DPSN_ERROR_CODES.CLIENT_NOT_INITIALIZED,
        message: 'Cannot disconnect: DPSN client not initialized.',
        status: 'disconnected',
      });
      throw dpsnError;
    }

    return new Promise<void>((resolve, reject) => {
      // Set up event handlers for the disconnect process
      this.dpsnBroker!.once('close', () => {
        this.connected = false;
        this.emit('disconnect_success');
        console.log('✅ Successfully disconnected from DPSN broker');
        resolve();
      });

      this.dpsnBroker!.once('error', (error) => {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.DISCONNECT_ERROR,
          message: `Error during disconnect: ${error.message}`,
          status: 'disconnected',
        });
        this.emit('error', dpsnError);
        reject(dpsnError);
      });

      // End the connection - false means wait for in-flight messages to complete
      this.dpsnBroker?.end(false, undefined, (err) => {
        if (err) {
          const dpsnError = new DPSNError({
            code: DPSN_ERROR_CODES.DISCONNECT_ERROR,
            message: `Failed to disconnect: ${
              err instanceof Error ? err.message : 'Unknown error'
            }`,
            status: 'disconnected',
          });
          this.emit('error', dpsnError);
          reject(dpsnError);
        }
        // We don't resolve here because we want to wait for the 'close' event
        this.initializing = null;
      });
    });
  }
}

// Export types for TypeScript users
export type { InitOptions, DPSNError };

const defaultExport = DpsnClient;

// Export as default for ESM
export default defaultExport;
