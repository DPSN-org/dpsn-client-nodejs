"use strict";
// TODO: 1. On error callbacks for subscribe and publish.
//TODO:  readme.md, for cli tool. 
//TODO: index.html, which help user to
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mqtt_1 = __importDefault(require("mqtt"));
const ethers_1 = require("ethers");
const contract_abi_1 = require("./topicregistry-abi/contract.abi");
const waitForTransactionConfirmation_1 = require("./utils/waitForTransactionConfirmation");
/**
 * Validates chain options for DPSN client
 * @param options - Chain configuration options
 */
function validateChainOptions(options) {
    if (!options.rpcUrl)
        throw new Error('RPC URL is required');
    if (!['mainnet', 'testnet'].includes(options.network)) {
        throw new Error('Network must be either mainnet or testnet');
    }
    if (options.wallet_chain_type !== 'ethereum') {
        throw new Error('Only Ethereum wallet_chain_type is supported right now');
    }
    if (typeof options.isMainnet !== 'boolean' || typeof options.isTestnet !== 'boolean') {
        throw new Error('isMainnet and isTestnet must be boolean values');
    }
}
/**
 * DPSN MQTT library for managing topic subscriptions and publications
 */
class DpsnClient {
    constructor(dpsnUrl, privateKey, chainOptions) {
        this.connected = false;
        // Validate chain options
        validateChainOptions(chainOptions);
        // Set up chain configuration
        this.provider = new ethers_1.ethers.JsonRpcProvider(chainOptions.rpcUrl);
        this.wallet = new ethers_1.ethers.Wallet(privateKey, this.provider);
        this.walletAddress = this.wallet.address;
        this.mainnet = chainOptions.isMainnet;
        this.testnet = chainOptions.isTestnet;
        this.blockchainType = chainOptions.wallet_chain_type;
        this.dpsnUrl = `mqtt://${dpsnUrl}`;
        this.topicContractAbi = contract_abi_1.TopicRegistryAbi;
    }
    connectWithRetry(mqttOptions, retryOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const maxRetries = (_a = retryOptions === null || retryOptions === void 0 ? void 0 : retryOptions.maxRetries) !== null && _a !== void 0 ? _a : 3;
            const initialDelay = (_b = retryOptions === null || retryOptions === void 0 ? void 0 : retryOptions.initialDelay) !== null && _b !== void 0 ? _b : 1000;
            const maxDelay = (_c = retryOptions === null || retryOptions === void 0 ? void 0 : retryOptions.maxDelay) !== null && _c !== void 0 ? _c : 10000;
            const useExponential = (_d = retryOptions === null || retryOptions === void 0 ? void 0 : retryOptions.exponentialBackoff) !== null && _d !== void 0 ? _d : true;
            const attemptConnect = (...args_1) => __awaiter(this, [...args_1], void 0, function* (retryCount = 0) {
                try {
                    return yield new Promise((resolve, reject) => {
                        this.dpsnBroker = mqtt_1.default.connect(this.dpsnUrl, mqttOptions);
                        if (!this.dpsnBroker) {
                            throw new Error('Dpsn client initialization failed');
                        }
                        const connectionTimeout = setTimeout(() => {
                            var _a;
                            (_a = this.dpsnBroker) === null || _a === void 0 ? void 0 : _a.end(true);
                            reject(new Error(`Connection timeout after ${mqttOptions.connectTimeout}ms`));
                        }, mqttOptions.connectTimeout);
                        this.dpsnBroker.on('error', (error) => {
                            this.connected = false;
                            clearTimeout(connectionTimeout);
                            const dpsnError = {
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
                }
                catch (error) {
                    if (retryCount < maxRetries) {
                        const delay = useExponential
                            ? Math.min(initialDelay * Math.pow(2, retryCount), maxDelay)
                            : initialDelay;
                        yield new Promise(resolve => setTimeout(resolve, delay));
                        return attemptConnect(retryCount + 1);
                    }
                    throw error;
                }
            });
            return attemptConnect();
        });
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
    init() {
        return __awaiter(this, arguments, void 0, function* (options = {}) {
            var _a;
            try {
                const signature = yield this.wallet.signMessage('testing');
                this.password = signature;
                const mqttOptions = {
                    username: this.walletAddress,
                    password: this.password,
                    protocolVersion: 5,
                    connectTimeout: (_a = options.connectTimeout) !== null && _a !== void 0 ? _a : 5000,
                    clean: true
                };
                yield this.connectWithRetry(mqttOptions, options.retryOptions);
                this.dpsnBroker.on('error', (error) => {
                    this.errorCallback(error);
                });
                this.dpsnBroker.on('close', () => {
                    this.connected = false;
                });
                this.dpsnBroker.on('disconnect', () => {
                    this.connected = false;
                });
                this.dpsnBroker.on('offline', () => {
                    this.connected = false;
                });
                return this.dpsnBroker;
            }
            catch (error) {
                throw error;
            }
        });
    }
    onConnect(callback) {
        this.connectCallback = callback;
    }
    onError(callback) {
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
    publish(topic_1, message_1) {
        return __awaiter(this, arguments, void 0, function* (topic, message, options = { qos: 1, retain: false }) {
            if (!this.dpsnBroker) {
                throw new Error('❌ MQTT client not initialized. Call init() first.');
            }
            const parentTopic = topic.split("/")[0];
            if (!/^0x[0-9a-fA-F]+$/.test(parentTopic)) {
                throw new Error('❌ Invalid topic format. Topic must be a hex string starting with 0x');
            }
            try {
                const signature = yield this.wallet.signMessage(ethers_1.ethers.toBeArray(parentTopic));
                const publishOptions = Object.assign(Object.assign({}, options), { properties: {
                        userProperties: {
                            signature: [signature]
                        }
                    } });
                return new Promise((resolve, reject) => {
                    this.dpsnBroker.publish(topic, JSON.stringify(message), publishOptions, (error) => {
                        var _a;
                        if (error) {
                            const dpsnError = {
                                code: 'DPSN_PUBLISH_ERROR',
                                message: error.message || 'Failed to publish message' + "connection disconnected",
                            };
                            // Emit the error event to trigger global handler
                            (_a = this.dpsnBroker) === null || _a === void 0 ? void 0 : _a.emit('error', dpsnError);
                            return reject(dpsnError);
                        }
                        console.log(`✅ Successfully published to '${topic}' with QoS ${options.qos}`);
                        resolve();
                    });
                });
            }
            catch (error) {
                console.error(`❌ Error while preparing message for topic '${topic}':`, error);
                throw error;
            }
        });
    }
    /**
     * Subscribe to a MQTT topic and handle incoming messages
     * @param topic - The topic to subscribe to
     * @param callback - Callback function that will be called with received messages
     * @param options - Optional MQTT subscription options
     * @returns Promise that resolves when subscription is successful
     * @throws Error if MQTT client is not initialized or subscription fails
     */
    subscribe(topic_1, callback_1) {
        return __awaiter(this, arguments, void 0, function* (topic, callback, options = { qos: 1 }) {
            if (!this.dpsnBroker) {
                const dpsnError = {
                    code: 'DPSN_CLIENT_NOT_INITIALIZED',
                    message: 'Cannot subscribe: MQTT client not initialized. Please ensure init() is called first.',
                    status: 'disconnected'
                };
                throw dpsnError;
            }
            if (!this.connected) {
                const dpsnError = {
                    code: 'DPSN_CLIENT_NOT_CONNECTED',
                    message: 'Cannot subscribe: MQTT client is not connected. Please check your connection.',
                    status: 'disconnected'
                };
                throw dpsnError;
            }
            try {
                yield new Promise((resolve, reject) => {
                    this.dpsnBroker.subscribe(topic, options, (error, granted) => {
                        var _a;
                        if (error) {
                            const dpsnError = {
                                code: 'DPSN_SUBSCRIBE_ERROR',
                                message: `Failed to subscribe to topic '${topic}': ${error.message}`,
                            };
                            (_a = this.dpsnBroker) === null || _a === void 0 ? void 0 : _a.emit('error', dpsnError);
                            reject(dpsnError);
                            return;
                        }
                        if (!granted || granted.length === 0) {
                            const dpsnError = {
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
                this.dpsnBroker.on('message', (receivedTopic, message, packet) => {
                    if (receivedTopic === topic) {
                        try {
                            const parsedMessage = JSON.parse(message.toString());
                            callback(receivedTopic, parsedMessage, packet);
                        }
                        catch (error) {
                            console.warn(`⚠️ Error parsing message from topic '${topic}':`, error);
                            // Call callback with raw message if JSON parsing fails
                            callback(receivedTopic, message.toString(), packet);
                        }
                    }
                });
            }
            catch (error) {
                const dpsnError = {
                    code: 'DPSN_SUBSCRIBE_SETUP_ERROR',
                    message: `Failed to set up subscription for topic '${topic}': ${error instanceof Error ? error.message : 'Unknown error'}`
                };
                throw dpsnError;
            }
        });
    }
    fetchOwnedTopics() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                if (!this.contract) {
                    throw new Error('Contract not initialized. Please call setContractAddress first.');
                }
                const topicHashes = yield ((_a = this.contract) === null || _a === void 0 ? void 0 : _a.getUserTopics(this.walletAddress));
                return topicHashes;
            }
            catch (error) {
                throw new Error(`Failed to fetch owned topics: ${error.message}`);
            }
        });
    }
    /**
     * Fetches the current price of a topic from the smart contract
     * @param contract - The contract instance
     * @returns The topic price in wei
     * @throws Error if the price fetch fails
     */
    getTopicPrice() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                if (!this.contract) {
                    throw new Error('Contract not initialized. Please call setContractAddress first.');
                }
                const price = yield ((_a = this.contract) === null || _a === void 0 ? void 0 : _a.getTopicPrice());
                return price;
            }
            catch (error) {
                throw new Error(`Failed to fetch topic price: ${error.message}`);
            }
        });
    }
    /**
     * Checks if the user has enough balance to pay for a topic registration
     * @param price - The price of the topic in wei
     * @throws Error if balance is insufficient
     */
    checkBalance(price) {
        return __awaiter(this, void 0, void 0, function* () {
            const balance = yield this.provider.getBalance(this.walletAddress);
            if (balance < price) {
                throw new Error(`Insufficient balance. Required: ${ethers_1.ethers.formatEther(price)} ETH, ` +
                    `Available: ${ethers_1.ethers.formatEther(balance)} ETH`);
            }
        });
    }
    /**
     * Generates a topic hash using the current timestamp and topic name
     * @param topicName - Name of the topic (e.g., "0xdpsn02BTC/USD")
     * @returns The generated topic hash
     */
    generateTopicHash(topicName) {
        const timestampNonce = Math.floor(Date.now() / 1000);
        const topicSeed = `${timestampNonce}_${topicName}`;
        return ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(topicSeed));
    }
    /**
     * Registers a new topic in the contract with automatic hash generation
     * @param contract - The contract instance
     * @param topicName - Name of the topic (e.g., "0xdpsn02BTC/USD")
     * @returns Transaction receipt and the generated topic hash
     * @throws Error if registration fails or if balance is insufficient
     */
    purchaseTopic(topicName) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const price = ethers_1.ethers.toBigInt(yield this.getTopicPrice());
                yield this.checkBalance(price);
                const topicHash = this.generateTopicHash(topicName);
                console.log('Generated topic hash:', topicHash);
                const signature = yield this.wallet.signMessage(ethers_1.ethers.getBytes(topicHash));
                console.log('Generated signature:', signature);
                if (!this.contract) {
                    throw new Error('Contract not initialized. Please call setContractAddress first.');
                }
                const getContractAddress = yield this.contract.getAddress();
                const contractSigner = new ethers_1.ethers.Contract(getContractAddress, this.topicContractAbi, this.wallet);
                console.log(`Purchasing topic '${topicName}' for ${ethers_1.ethers.formatEther(price)} ETH`);
                // Send transaction
                const tx = yield contractSigner.registerTopic(topicName, topicHash, signature, { value: price });
                console.log('Transaction sent. Hash:', tx.hash);
                const receipt = yield (0, waitForTransactionConfirmation_1.waitForTransactionConfirmation)(this.provider, tx.hash, {
                    confirmations: 2,
                    timeout: 120000,
                    pollingInterval: 5000
                });
                return { receipt, topicHash };
            }
            catch (error) {
                console.error('Error details:');
                if (error.data) {
                    console.error('Contract error:', error.data);
                }
                if (error.transaction) {
                    console.error('Transaction:', error.transaction);
                }
                console.error('Full error:', error);
                throw new Error(`Failed to register topic: ${error.message}`);
            }
        });
    }
    /**
     * Creates a contract interface for interacting with the smart contract
     * @param contractAddress - The address of the deployed contract
     * @returns The contract interface
     */
    setContractAddress(contractAddress) {
        if (!this.provider) {
            throw new Error('RPC client not initialized. Please check your RPC URL.');
        }
        try {
            this.contract = new ethers_1.ethers.Contract(contractAddress, this.topicContractAbi, this.provider);
            // this.contract = contract;
            // return contract;
        }
        catch (error) {
            throw new Error(`Failed to create contract interface: ${error.message}`);
        }
    }
}
exports.default = DpsnClient;
