import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { ethers } from 'ethers';
import { TopicRegistryAbi } from './topicregistry-abi/contract.abi';
import { waitForTransactionConfirmation } from './utils/waitForTransactionConfirmation';

type NetworkType = 'mainnet' | 'testnet';

interface DPSNError {
    code?: string;
    message?: string;
    status?: 'connected' | 'disconnected'
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
    connectTimeout?: number;        // Connection timeout in milliseconds
    retryOptions?: {
        maxRetries?: number;         // Maximum number of retry attempts
        initialDelay?: number;       // Initial delay between retries in milliseconds
        maxDelay?: number;           // Maximum delay between retries in milliseconds
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
 * DPSN MQTT library for managing topic subscriptions and publications
 */
class DpsnClient {
    private provider!: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private walletAddress: string;
    private mainnet: boolean;
    private testnet: boolean;
    private blockchainType: string;
    private password?: string;
    public dpsnBroker?: MqttClient;
    private topicContractAbi: any;
    public dpsnUrl:string;
    private connected:boolean = false;
    private connectCallback:any;
    private errorCallback:any;
    private contract?:ethers.Contract;
    private initializing: Promise<MqttClient> | null = null;

    constructor(dpsnUrl: string, privateKey: string, chainOptions: ChainOptions, connectionOptions: ConnectionOptions = { ssl: true }) {

        // Validate chain options
        validateChainOptions(chainOptions);
    
        // Set up chain configuration
        if(chainOptions.rpcUrl){
            this.provider = new ethers.JsonRpcProvider(chainOptions.rpcUrl);
        }

        this.wallet = new ethers.Wallet(privateKey);

        this.walletAddress = this.wallet.address;
        this.mainnet = chainOptions.network === 'mainnet' ;
        this.testnet = chainOptions.network === 'testnet';
        
        this.blockchainType = chainOptions.wallet_chain_type;
        // Use mqtts:// or mqtt:// based on useSSL parameter
        const protocol = connectionOptions.ssl !== false ? 'mqtts' : 'mqtt';
        this.dpsnUrl = `${protocol}://${dpsnUrl}`
        this.topicContractAbi = TopicRegistryAbi;
        
        // Set default callbacks to prevent errors if not set by user
        this.connectCallback = (msg: any) => console.log(msg);
        this.errorCallback = (error: any) => console.error(error);
    }


    private async connectWithRetry(mqttOptions: IClientOptions, retryOptions?: InitOptions['retryOptions']): Promise<void> {
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
                        reject(new Error(`Connection timeout after ${mqttOptions.connectTimeout}ms`));
                    }, mqttOptions.connectTimeout);

                    this.dpsnBroker.on('error', (error) => {
                        this.connected = false;
                        clearTimeout(connectionTimeout);
                        const dpsnError: DPSNError = {
                            code: 'DPSN_CONNECTION_ERROR',
                            message: 'Connection error occurred',
                            status: 'disconnected'
                        };
                        this.errorCallback(dpsnError);
                        reject(dpsnError);
                    });

                    this.dpsnBroker.on('connect', () => {
                        clearTimeout(connectionTimeout);
                        this.connected = true;
                        this.connectCallback("[CONNECTION ESTABLISHED]");
                        resolve();
                    });
                });
            } catch (error) {
                if (retryCount < maxRetries) {
                    const delay = useExponential
                        ? Math.min(initialDelay * Math.pow(2, retryCount), maxDelay)
                        : initialDelay;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return attemptConnect(retryCount + 1);
                }
                throw error;
            }
        };

        return attemptConnect();
    }

    /**
     * Initialize the MQTT client and connect to the DPSN broker
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
    private async ensureInitialized(options: InitOptions = {}): Promise<MqttClient> {
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
            const signature = await this.wallet.signMessage('testing');
            this.password = signature;

            const mqttOptions: IClientOptions = {
                username: this.walletAddress,
                password: this.password,
                protocolVersion: 5,
                connectTimeout: options.connectTimeout ?? 5000,
                clean: true
            };

            await this.connectWithRetry(mqttOptions, options.retryOptions);

            this.dpsnBroker!.on('error', (error) => {
                this.errorCallback(error);
            });

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
            throw error;
        }
    }
        

    onConnect(callback:any){
            this.connectCallback = callback;
        }

    onError(callback:any){
            this.errorCallback = callback;
        }

        

    /**
     * Publish a message to a MQTT topic with signature
     * @param topic - The topic to publish to (must be a hex string)
     * @param message - The message to publish (will be JSON stringified)
     * @param options - Optional MQTT publish options (QoS, retain, etc.)
     * @returns Promise that resolves when publish is successful
     * @throws Error if MQTT client is not initialized, topic is invalid, or publish fails
     */
    async publish(
        topic: string,
        message: any,
        options: Partial<mqtt.IClientPublishOptions> = { qos: 1, retain: false }
    ): Promise<void> {
        // Ensure client is initialized before publishing
        await this.ensureInitialized();
        
        if (!this.dpsnBroker) {
            throw new Error('❌ MQTT client not initialized. Initialization failed.');
        }

        const parentTopic = topic.split("/")[0];

        if (!/^0x[0-9a-fA-F]+$/.test(parentTopic)) {
            throw new Error('❌ Invalid topic format. Topic must be a hex string starting with 0x');
        }

        try {
            const signature = await this.wallet.signMessage(ethers.toBeArray(parentTopic));
            
            const publishOptions: MqttPublishOptions = {
                ...options,
                properties: {
                    userProperties: {
                        signature: [signature]
                    }
                }
            };

            return new Promise((resolve, reject) => {
                this.dpsnBroker!.publish(
                    topic,
                    JSON.stringify(message),
                    publishOptions,
                    (error) => {
                        if (error) {
                            const dpsnError: DPSNError = {
                                code: 'DPSN_PUBLISH_ERROR',
                                message: error.message || 'Failed to publish message' + "connection disconnected",
                            };
                            // Emit the error event to trigger global handler
                            this.dpsnBroker?.emit('error', dpsnError as Error);
                            return reject(dpsnError);
                        }
                        console.log(`✅ Successfully published to '${topic}' with QoS ${options.qos}`);
                        resolve();
                    }
                );
            });
        } catch (error) {
            console.error(`❌ Error while preparing message for topic '${topic}':`, error);
            throw error;
        }
    }



    /**
     * Subscribe to a MQTT topic and handle incoming messages
     * @param topic - The topic to subscribe to
     * @param callback - Callback function that will be called with received messages
     * @param options - Optional MQTT subscription options
     * @returns Promise that resolves when subscription is successful
     * @throws Error if MQTT client is not initialized or subscription fails
     */
    async subscribe(
        topic: string,
        callback: (topic: string, message: any, packet?: mqtt.IPublishPacket) => void,
        options: mqtt.IClientSubscribeOptions = { qos: 1 }
    ): Promise<void> {
        // Ensure client is initialized before subscribing
        try {
            await this.ensureInitialized();
        } catch (error) {
            const dpsnError: DPSNError = {
                code: 'DPSN_INITIALIZATION_FAILED',
                message: `Failed to initialize MQTT client: ${error instanceof Error ? error.message : 'Unknown error'}`,
                status: 'disconnected'
            };
            throw dpsnError;
        }
        
        if (!this.dpsnBroker) {
            const dpsnError: DPSNError = {
                code: 'DPSN_CLIENT_NOT_INITIALIZED',
                message: 'Cannot subscribe: MQTT client not initialized. Initialization failed.',
                status: 'disconnected'
            };
            throw dpsnError;
        }

        if (!this.connected) {
            const dpsnError: DPSNError = {
                code: 'DPSN_CLIENT_NOT_CONNECTED',
                message: 'Cannot subscribe: MQTT client is not connected. Please check your connection.',
                status: 'disconnected'
            };
            throw dpsnError;
        }

        try {
            await new Promise<void>((resolve, reject) => {
                this.dpsnBroker!.subscribe(topic, options, (error, granted) => {
                    if (error) {
                        const dpsnError: DPSNError = {
                            code: 'DPSN_SUBSCRIBE_ERROR',
                            message: `Failed to subscribe to topic '${topic}': ${error.message}`,

                        };
                        this.dpsnBroker?.emit('error', dpsnError as Error);
                        reject(dpsnError);
                        return;
                    }

                    if (!granted || granted.length === 0) {
                        const dpsnError: DPSNError = {
                            code: 'DPSN_SUBSCRIBE_NO_GRANT',
                            message: `No subscription granted for topic '${topic}'`,
                        };
                        reject(dpsnError);
                        return;
                    }

                    const grantedQoS = granted[0].qos;
                    console.log(`✅ Successfully subscribed to '${topic}' with QoS ${grantedQoS}`);
                    resolve();
                });
            });

            // Set up message handler for this topic
            this.dpsnBroker.on('message', (receivedTopic: string, message: Buffer, packet: mqtt.IPublishPacket) => {
                if (receivedTopic === topic) {
                    try {
                        const parsedMessage = JSON.parse(message.toString());

                        callback(receivedTopic, parsedMessage, packet);
                    } catch (error) {
                        console.warn(`⚠️ Error parsing message from topic '${topic}':`, error);
                        // Call callback with raw message if JSON parsing fails
                        callback(receivedTopic, message.toString(), packet);
                    }
                }
            });

        } catch (error) {
            const dpsnError: DPSNError = {
                code: 'DPSN_SUBSCRIBE_SETUP_ERROR',
                message: `Failed to set up subscription for topic '${topic}': ${error instanceof Error ? error.message : 'Unknown error'}`

            };
            throw dpsnError;
        }
    }

    async fetchOwnedTopics(): Promise<string[]> {
        try {

            if (!this.contract) {
                throw new Error('Blockchain configuration not initialized. Please call setBlockchainConfig first.');
            }
            
            const topicHashes = await this.contract?.getUserTopics(this.walletAddress);
            return topicHashes;
        } catch (error) {
            throw new Error(`Failed to fetch owned topics: ${(error as Error).message}`);
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
                throw new Error('Blockchain configuration not initialized. Please call setBlockchainConfig first.');
            }
            const price = await this.contract?.getTopicPrice();
            return price;
        } catch (error) {
            throw new Error(`Failed to fetch topic price: ${(error as Error).message}`);
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
     * Registers a new topic in the contract with automatic hash generation
     * @param contract - The contract instance
     * @param topicName - Name of the topic (e.g., "0xdpsn02BTC/USD")
     * @returns Transaction receipt and the generated topic hash
     * @throws Error if registration fails or if balance is insufficient
     */
    async purchaseTopic(
        topicName: string
    ): Promise<{ receipt: ethers.TransactionReceipt; topicHash: string }> {
        try {

            if (!this.contract) {
                throw new Error('Blockchain configuration not initialized. Please call setBlockchainConfig first.');
            }
            
            if(!this.provider){
                throw new Error('Provider not initialized. Please call setBlockchainConfig first.');
            }

            const price = ethers.toBigInt(await this.getTopicPrice());

            await this.checkBalance(price);


            const topicHash = this.generateTopicHash(topicName);
            console.log('Generated topic hash:', topicHash);

            const signature = await this.wallet.signMessage(ethers.getBytes(topicHash));
            console.log('Generated signature:', signature);

         

            const getContractAddress = await this.contract.getAddress();

            // Connect the wallet to the provider before creating the contract instance
            const connectedWallet = this.wallet.connect(this.provider);
            
            const contractSigner = new ethers.Contract(
              getContractAddress,
              this.topicContractAbi,
              connectedWallet
            )


          
            console.log(`Purchasing topic '${topicName}' for ${ethers.formatEther(price)} ETH`);

            // Send transaction
            const tx = await contractSigner.registerTopic(
                topicName,
                topicHash,
                signature,
                { value: price }
            );
            console.log('Transaction sent. Hash:', tx.hash);


            const receipt = await waitForTransactionConfirmation(this.provider, tx.hash, {
                confirmations: 2,           
                timeout: 120000,          
                pollingInterval: 5000      
            });


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
    setBlockchainConfig(rpcUrl?: string, contractAddress?: string): ethers.Contract {
        if(rpcUrl) 
        {// Set the provider first
        this.setProvider(rpcUrl);
        }
        if(contractAddress){
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
            throw new Error('Provider not initialized. Please call setBlockchainConfig first.');
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
            throw new Error(`Failed to create contract interface: ${(error as Error).message}`);
        }
    }

    /**
     * Disconnects from the MQTT broker and cleans up resources
     * @returns Promise that resolves when disconnection is complete
     * @throws Error if MQTT client is not initialized or disconnection fails
     */
    async disconnect(): Promise<void> {
        if (!this.dpsnBroker) {
            const dpsnError: DPSNError = {
                code: 'DPSN_CLIENT_NOT_INITIALIZED',
                message: 'Cannot disconnect: MQTT client not initialized.',
                status: 'disconnected'
            };
            throw dpsnError;
        }

        return new Promise<void>((resolve, reject) => {
            try {
                // Set up one-time event handlers for disconnect confirmation
                this.dpsnBroker!.once('close', () => {
                    this.connected = false;
                    console.log('✅ Successfully disconnected from DPSN broker');
                    resolve();
                });

                this.dpsnBroker!.once('error', (error) => {
                    const dpsnError: DPSNError = {
                        code: 'DPSN_DISCONNECT_ERROR',
                        message: `Error during disconnect: ${error.message}`,
                        status: 'disconnected'
                    };
                    reject(dpsnError);
                });

                // End the connection - false means wait for in-flight messages to complete
                this.dpsnBroker?.end(false, undefined, () => {
                    // This callback is sometimes not triggered in certain MQTT implementations
                    // so we rely primarily on the 'close' event above
                    this.initializing = null;
                });
            } catch (error) {
                const dpsnError: DPSNError = {
                    code: 'DPSN_DISCONNECT_ERROR',
                    message: `Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    status: 'disconnected'
                };
                reject(dpsnError);
            }
        });
    }
}



// Export types for TypeScript users
export type { ChainOptions, NetworkType, InitOptions, DPSNError, ConnectionOptions };

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
