import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { ethers } from 'ethers';
import { TopicRegistryAbi } from './topicregistry-abi/contract.abi';
import { waitForTransactionConfirmation } from './utils/waitForTransactionConfirmation';
import { EventEmitter } from 'events';

type NetworkType = 'mainnet' | 'testnet';

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
  BLOCKCHAIN_CONFIG_ERROR = 410,
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
 * Check if an error is from ethers.js
 * @param error The error to check
 * @returns True if the error is from ethers.js
 */
function isEthersError(error: any): boolean {
  // Check for common ethers.js error properties
  return (
    error &&
    (error.code === 'INVALID_ARGUMENT' ||
      (typeof error.code === 'string' &&
        (error.code.startsWith('CALL_EXCEPTION') ||
          error.code.startsWith('NONCE_EXPIRED') ||
          error.code.startsWith('REPLACEMENT_UNDERPRICED') ||
          error.code.startsWith('UNPREDICTABLE_GAS_LIMIT'))) ||
      // Check for transaction-related errors
      error.transaction !== undefined ||
      // Check for provider-related errors
      error.connection !== undefined ||
      // Check for specific ethers error message patterns
      (typeof error.message === 'string' &&
        (error.message.includes('invalid BytesLike') ||
          error.message.includes('transaction') ||
          error.message.includes('contract') ||
          error.message.includes('provider') ||
          error.message.includes('network') ||
          error.message.includes('gas'))))
  );
}

/**
 * Validate private key format using ethers.js
 * @param privateKey The private key to validate
 * @throws DPSNError if the private key is invalid
 */
function validatePrivateKey(privateKey: string): void {
  try {
    // Let ethers.js validate the private key
    new ethers.Wallet(privateKey);
  } catch (error) {
    throw new DPSNError({
      code: DPSN_ERROR_CODES.INVALID_PRIVATE_KEY,
      message: `Invalid private key: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      status: 'disconnected',
    });
  }
}

interface ChainOptions {
  network: NetworkType;
  wallet_chain_type: string;
  rpcUrl?: string;
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
 * Connection options for DPSN client
 */
interface ConnectionOptions {
  /**
   * Whether to use SSL for MQTT connection
   * If true, mqtts:// protocol will be used
   * If false, mqtt:// protocol will be used
   */
  ssl?: boolean;
}

/**
 * Validates chain options for DPSN client
 * @param options - Chain configuration options
 */
function validateChainOptions(options: ChainOptions): void {
  if (!['mainnet', 'testnet'].includes(options.network)) {
    throw new Error('Network must be either mainnet or testnet');
  }
  if (options.wallet_chain_type !== 'ethereum') {
    throw new Error('Only Ethereum wallet_chain_type is supported right now');
  }
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
class DpsnClient extends EventEmitter {
  private provider!: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private walletAddress: string;
  private mainnet: boolean;
  private testnet: boolean;
  private blockchainType: string;
  private password?: string;
  public dpsnBroker?: MqttClient;
  private topicContractAbi: any;
  public dpsnUrl: string;
  private connected: boolean = false;
  private contract?: ethers.Contract;
  private initializing: Promise<MqttClient> | null = null;

  private topicCallbacks = new Map<
    string,
    (topic: string, message: any, packet?: mqtt.IPublishPacket) => void
  >();

  constructor(
    dpsnUrl: string,
    privateKey: string,
    chainOptions: ChainOptions,
    connectionOptions: ConnectionOptions = { ssl: true }
  ) {
    super();
    try {
      validateChainOptions(chainOptions);
      validatePrivateKey(privateKey);

      if (chainOptions.rpcUrl) {
        this.provider = new ethers.JsonRpcProvider(chainOptions.rpcUrl);
      }

      this.wallet = new ethers.Wallet(privateKey);

      this.walletAddress = this.wallet.address;
      this.mainnet = chainOptions.network === 'mainnet';
      this.testnet = chainOptions.network === 'testnet';

      this.blockchainType = chainOptions.wallet_chain_type;
      const protocol = connectionOptions.ssl !== false ? 'mqtts' : 'mqtt';
      this.dpsnUrl = `${protocol}://${dpsnUrl}`;
      this.topicContractAbi = TopicRegistryAbi;
    } catch (error) {
      // If it's already a DPSNError (like INVALID_PRIVATE_KEY), just rethrow it
      if (error instanceof DPSNError) {
        throw error;
      }
      // Check for ethers.js errors
      if (isEthersError(error)) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.ETHERS_ERROR,
          message: `Blockchain initialization error: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          status: 'disconnected',
        });
        throw dpsnError;
      }
      // Handle all other errors
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
        case 'message':
          return super.on(
            'message',
            listener as (
              topic: string,
              message: any,
              packet?: mqtt.IPublishPacket
            ) => void
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
        // Forward MQTT errors to our event emitter
        // Create a clean DPSNError before emitting
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
          if (callback) callback(receivedTopic, data, packet);
          super.emit('message', receivedTopic, data, packet);
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

    const parentTopic = topic.split('/')[0];

    if (!/^0x[0-9a-fA-F]+$/.test(parentTopic)) {
      throw new Error(
        '❌ Invalid DPSN topic format. Topic must be a hex string starting with 0x'
      );
    }

    try {
      const signature = await this.wallet.signMessage(
        ethers.toBeArray(parentTopic)
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
    callback: (
      topic: string,
      message: any,
      packet?: mqtt.IPublishPacket
    ) => void,
    options: mqtt.IClientSubscribeOptions = { qos: 1 }
  ): Promise<void> {
    // Ensure client is initialized before subscribing
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

  async fetchOwnedTopics(): Promise<string[]> {
    try {
      if (!this.contract) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.BLOCKCHAIN_CONFIG_ERROR,
          message:
            'Blockchain configuration not initialized. Please call setBlockchainConfig first.',
          status: 'disconnected',
        });
        throw dpsnError;
      }

      const topicHashes = await this.contract?.getUserTopics(
        this.walletAddress
      );
      return topicHashes;
    } catch (error) {
      throw new Error(
        `Failed to fetch owned topics: ${(error as Error).message}`
      );
    }
  }

  /**
   * Fetches the current price of a topic from the smart contract
   * @param contract - The contract instance
   * @returns The topic price in wei
   * @throws Error if the price fetch fails
   */
  async getTopicPrice(): Promise<ethers.BigNumberish> {
    try {
      if (!this.contract) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.BLOCKCHAIN_CONFIG_ERROR,
          message:
            'Blockchain configuration not initialized. Please call setBlockchainConfig first.',
          status: 'disconnected',
        });
        throw dpsnError;
      }
      const price = await this.contract?.getTopicPrice();
      return price;
    } catch (error) {
      throw new Error(
        `Failed to fetch topic price: ${(error as Error).message}`
      );
    }
  }

  /**
   * Checks if the user has enough balance to pay for a topic registration
   * @param price - The price of the topic in wei
   * @throws Error if balance is insufficient
   */
  private async checkBalance(price: bigint): Promise<void> {
    const balance = await this.provider.getBalance(this.walletAddress);
    if (balance < price) {
      throw new Error(
        `Insufficient balance. Required: ${ethers.formatEther(price)} ETH, ` +
          `Available: ${ethers.formatEther(balance)} ETH`
      );
    }
  }

  /**
   * Generates a topic hash using the current timestamp and topic name
   * @param topicName - Name of the topic (e.g., "0xdpsn02BTC/USD")
   * @returns The generated topic hash
   */
  private generateTopicHash(topicName: string): string {
    const timestampNonce = Math.floor(Date.now() / 1000);
    const topicSeed = `${timestampNonce}_${topicName}`;
    return ethers.keccak256(ethers.toUtf8Bytes(topicSeed));
  }

  /**
   * Registers a new DPSN topic in the contract with automatic hash generation
   * @param topicName - Name of the topic (e.g., "0xdpsn02BTC/USD")
   * @returns Transaction receipt and the generated topic hash
   * @throws Error if registration fails or if balance is insufficient
   */
  async purchaseTopic(
    topicName: string
  ): Promise<{ receipt: ethers.TransactionReceipt; topicHash: string }> {
    try {
      if (!this.contract) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.BLOCKCHAIN_CONFIG_ERROR,
          message:
            'Blockchain configuration not initialized. Please call setBlockchainConfig first.',
          status: 'disconnected',
        });
        throw dpsnError;
      }

      if (!this.provider) {
        const dpsnError = new DPSNError({
          code: DPSN_ERROR_CODES.BLOCKCHAIN_CONFIG_ERROR,
          message:
            'Provider not initialized. Please call setBlockchainConfig first.',
          status: 'disconnected',
        });
        throw dpsnError;
      }

      const price = ethers.toBigInt(await this.getTopicPrice());

      await this.checkBalance(price);

      const topicHash = this.generateTopicHash(topicName);
      console.log('Generated topic hash:', topicHash);

      const signature = await this.wallet.signMessage(
        ethers.getBytes(topicHash)
      );
      console.log('Generated signature:', signature);

      const getContractAddress = await this.contract.getAddress();

      // Connect the wallet to the provider before creating the contract instance
      const connectedWallet = this.wallet.connect(this.provider);

      const contractSigner = new ethers.Contract(
        getContractAddress,
        this.topicContractAbi,
        connectedWallet
      );

      console.log(
        `Purchasing topic '${topicName}' for ${ethers.formatEther(price)} ETH`
      );

      // Send transaction
      const tx = await contractSigner.registerTopic(
        topicName,
        topicHash,
        signature,
        { value: price }
      );
      console.log('Transaction sent. Hash:', tx.hash);

      const receipt = await waitForTransactionConfirmation(
        this.provider,
        tx.hash,
        {
          confirmations: 2, // Wait for 2 confirmations
          timeout: 120000, // 2 minutes
          pollingInterval: 5000, // Check every 5 seconds
        }
      );

      return { receipt, topicHash };
    } catch (error) {
      console.error('Error details:');
      if ((error as any).data) {
        console.error('Contract error:', (error as any).data);
      }
      if ((error as any).transaction) {
        console.error('Transaction:', (error as any).transaction);
      }
      console.error('Full error:', error);
      throw new Error(`Failed to register topic: ${(error as Error).message}`);
    }
  }

  /**
   * Sets the JSON RPC provider for blockchain interactions
   * @param rpcUrl - The URL of the JSON RPC endpoint
   * @returns The provider instance
   */
  setProvider(rpcUrl: string): ethers.JsonRpcProvider {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    return this.provider;
  }

  /**
   * Sets both the provider and contract address in a single call
   * @param rpcUrl - The URL of the JSON RPC endpoint
   * @param contractAddress - The address of the deployed contract
   * @returns The initialized contract instance
   */
  setBlockchainConfig(
    rpcUrl?: string,
    contractAddress?: string
  ): ethers.Contract {
    if (rpcUrl) {
      // Set the provider first
      this.setProvider(rpcUrl);
    }
    if (contractAddress) {
      // Then set the contract address
      this.setContractAddress(contractAddress);
    }
    // Return the contract instance
    return this.contract!;
  }

  /**
   * Creates a contract interface for interacting with the smart contract
   * @param contractAddress - The address of the deployed contract
   * @returns The contract interface
   */
  setContractAddress(contractAddress: string): void {
    if (!this.provider) {
      throw new Error(
        'Provider not initialized. Please call setBlockchainConfig first.'
      );
    }
    const connectedWallet = this.wallet.connect(this.provider);
    try {
      this.contract = new ethers.Contract(
        contractAddress,
        this.topicContractAbi,
        connectedWallet
      );
      // this.contract = contract;

      // return contract;
    } catch (error) {
      throw new Error(
        `Failed to create contract interface: ${(error as Error).message}`
      );
    }
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
export type {
  ChainOptions,
  NetworkType,
  InitOptions,
  DPSNError,
  ConnectionOptions,
};

/**
 * Main export - use a simple pattern to avoid require cycles
 * This approach works in both CommonJS and ESM environments
 */

// Create the default export
const defaultExport = DpsnClient;

// Export as default for ESM
export default defaultExport;

// Export as named export for ESM
export { DpsnClient };

// Handle CommonJS interoperability
if (typeof module !== 'undefined' && module.exports) {
  // Use a direct assignment to avoid Object.assign which can cause issues
  module.exports = defaultExport;
}
