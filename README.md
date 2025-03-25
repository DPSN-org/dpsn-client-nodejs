# dpsn-client-nodejs

## Overview

`dpsn-client-nodejs` is an SDK for creating, accessing data streams on DPSN infrastructure. It allows you to connect to a DPSN broker, publish messages to topics, and subscribe to topics to receive messages.

For more information, visit:

- [DPSN Official Website](https://dpsn.org)
- [DPSN Streams Marketplace](https://streams.dpsn.org)


## Installation

```sh
npm install dpsn-client
```

## Usage


## Prerequisites

- DPSN URL: betanet.dpsn.org
- DPSN Smart Contract Address: 0xC4c4CFCB2EDDC26660850A4f422841645941E352 (on Base Sepolia testnet)
- Wallet private key: Your private key for a wallet on Base chain
- RPC URL: URL from any Base testnet RPC provider
- Minimum balance: 0.002 Base ETH to register a topic


### Import the Library

```ts
import {DpsnClient} from 'dpsn-client';
```

### Create Client Instance

```ts
const dpsnClient = new DpsnClient(<dpsn_url>, <private_key>, {
  network: 'testnet',
  wallet_chain_type: 'ethereum',
})
```

### Configure Blockchain Settings

```ts
dpsnClient.setBlockchainConfig(<base_rpc_url>, <contract_address>)
```

### Understanding DPSN Topics

Topics in DPSN are data distribution channels that enable secure, permissioned data streams. They function as:

- **Ownership-based channels**: Each topic is owned by the wallet that purchases it
- **Data streams**: Publishers push data to topics, and subscribers receive data from topics they're following
- **Permissioned resources**: Only the owner can publish to a topic, while anyone can subscribe to it
- **Authenticated channels**: The blockchain provides the authentication and ownership layer


Think of topics as secure broadcast channels where data integrity and publisher authenticity are guaranteed by blockchain verification.

### How Topic Ownership Works

When you purchase a topic:

1. Your wallet initiates a blockchain transaction to the DPSN smart contract on the Base Sepolia network.

2. This transaction:
   - Requires at least 0.002 Base ETH
   - Associates the topic name with your wallet's address in the contract
   - Generates a unique topicHash that becomes owned by your wallet

3. Authentication works through:
   - Your wallet's private key signing messages when publishing
   - The dpsn nodes  verifying that only the registered owner can publish to that topic

4. When publishing data, the publishing client uses the same private key that purchased the topic to authenticate the request, ensuring only authorized wallets can publish to their owned topics.



### Fetching Topic Price

To fetch the current price of purchasing a topic in the DPSN infrastructure, use the [`getTopicPrice`](src/index.ts) method:

```ts
const price = await dpsn.getTopicPrice();
console.log("Topic price:", price);
```

### Purchase Topic

> **Caution:** Ensure you have a minimum balance of 0.002 Base ETH available to prevent transaction failure

```ts
const {receipt, topicHash} = await dpsnClient.purchaseTopic(<topic_name>);
```
- `receipt`: Transaction receipt from the blockchain
- `topicHash`: Unique topic name owned by the wallet that executed the transaction


### Fetch Owned Topics

```ts
const topics = await dpsnClient.getOwnedTopics();
```
- Returns a list of topics owned by the configured wallet

### Setup Event Handlers

> **Note:** Set up these event handlers before calling `init()` to properly handle connection events

```ts
dpsnClient.on('connect', (res) => {
  console.log(res);
})

dpsnClient.on('publish', (res) => {
  console.log(res);
})

dpsnClient.on('subscription', (res) => {
  console.log("STARTED SUBSCRIPTION:", res)
})

dpsnClient.on('disconnect', (res) => {
  console.log(res);
})

dpsnClient.on('error', (err) => {
  console.log("OPERATION FAILED: ", err);
})
```

### Initialize DPSN Client

> **Caution:** Verify you've configured the correct DPSN url and wallet private key

```ts
await dpsnClient.init()
```

### Publish Data

> **Caution:** You must use the same private key that purchased the topic, otherwise authentication will fail

```ts
await dpsnClient.publish(<topic_hash>, <data>);
```

### Subscribing to Topics

To subscribe to a topic and handle incoming messages, use the [`subscribe`](src/index.ts) method:

```ts
await dpsnClient.subscribe("TOPIC_HASH", (topic, message, packet) => {
  console.log("Received message:", message);
});
```

### Unsubscribing from Topics

To unsubscribe from a topic when you no longer want to receive messages, use the [`unsubscribe`](src/index.ts) method:

```ts
const result = await dpsnClient.unsubscribe("TOPIC_HASH");
console.log(`Successfully unsubscribed from ${result.topic}: ${result.message}`);
```

This method returns a response object containing:
- `topic`: The topic you unsubscribed from
- `message`: A confirmation message ("unsubscribed")

### Disconnect

> For properly terminating the connection when needed

```ts
await dpsnClient.disconnect();
```





## API Reference

### Classes

#### [`DpsnClient`](src/index.ts)

##### Constructor

```ts
constructor(dpsnUrl: string, privateKey: string, chainOptions: ChainOptions, connectionOptions: ConnectionOptions = { ssl: true })
```

##### Methods

- [`init(options?: InitOptions): Promise<MqttClient>`](src/index.ts) - Initialize the DPSN client and connect to the broker
- [`on(event: DpsnEventType, callback: Function): this`](src/index.ts) - Register event handlers for various events (connect, subscription, publish, disconnect, error)
- [`onConnect(callback: (message: string) => void): void`](src/index.ts) - *Deprecated*: Register a callback for connection events (use `on('connect', callback)` instead)
- [`onError(callback: (error: Error | DPSNError) => void): void`](src/index.ts) - *Deprecated*: Register a callback for error events (use `on('error', callback)` instead)
- [`publish(topic: string, message: any, options?: Partial<mqtt.IClientPublishOptions>): Promise<void>`](src/index.ts) - Publish a message to a topic
- [`subscribe(topic: string, callback: (topic: string, message: any, packet?: mqtt.IPublishPacket) => void, options?: mqtt.IClientSubscribeOptions): Promise<void>`](src/index.ts) - Subscribe to a topic
- [`unsubscribe(topic: string): Promise<{topic: string, message: string}>`](src/index.ts) - Unsubscribe from a topic and stop receiving messages
- [`getOwnedTopics(): Promise<string[]>`](src/index.ts) - Get topics owned by the current wallet
- [`getTopicPrice(): Promise<ethers.BigNumberish>`](src/index.ts) - Get the current price to purchase a topic
- [`purchaseTopic(topicName: string): Promise<{ receipt: ethers.TransactionReceipt; topicHash: string }>`](src/index.ts) - Purchase a new topic
- [`setBlockchainConfig(rpcUrl: string, contractAddress: string): ethers.Contract`](src/index.ts) - Configure blockchain connection
- [`disconnect(): Promise<void>`](src/index.ts) - Disconnect from the MQTT broker and clean up resources

### Types

#### [`ChainOptions`](src/index.ts)

```ts
interface ChainOptions {
  network: NetworkType;
  wallet_chain_type: string;
  rpcUrl?: string;
}
```

#### [`ConnectionOptions`](src/index.ts)

```ts
interface ConnectionOptions {
  ssl?: boolean;
}
```

#### [`NetworkType`](src/index.ts)

```ts
type NetworkType = 'mainnet' | 'testnet';
```

#### [`InitOptions`](src/index.ts)

```ts
interface InitOptions {
  connectTimeout?: number;
  retryOptions?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    exponentialBackoff?: boolean;
  };
}
```

#### [`DpsnEventType`](src/index.ts)

```ts
type DpsnEventType = 'connect' | 'subscription' | 'publish' | 'disconnect' | 'error' | 'unsubscribe';
```

#### [`DpsnEventData`](src/index.ts)

```ts
type DpsnEventData = {
  connect: string;
  subscription: { topic: string, qos: number };
  publish: { topic: string, messageId?: number };
  disconnect: void;
  error: Error | DPSNError;
  unsubscribe: { topic: string };
};
```

#### [`DPSNError`](src/index.ts)

```ts
class DPSNError extends Error {
  code: DPSN_ERROR_CODES;
  status?: 'connected' | 'disconnected';
  
  constructor(options: {
    code: DPSN_ERROR_CODES;
    message: string;
    status?: 'connected' | 'disconnected';
    name?: string;
  });
  
  toJSON(): {
    code: DPSN_ERROR_CODES;
    message: string;
    status?: 'connected' | 'disconnected';
    name: string;
  };
}
```

### Error Codes

- CONNECTION_ERROR (400): Connection issues with the DPSN broker
- UNAUTHORIZED (401): Authentication or authorization failure
- PUBLISH_ERROR (402): Error when publishing to a topic
- INITIALIZATION_FAILED (403): Client initialization failure
- CLIENT_NOT_INITIALIZED (404): Operations attempted before initialization
- CLIENT_NOT_CONNECTED (405): Operations attempted without connection
- SUBSCRIBE_ERROR (406): General subscription errors
- SUBSCRIBE_NO_GRANT (407): Permission denied for subscription
- SUBSCRIBE_SETUP_ERROR (408): Error setting up subscription handlers
- DISCONNECT_ERROR (409): Error during disconnection
- BLOCKCHAIN_CONFIG_ERROR (410): Invalid blockchain configuration
- INVALID_PRIVATE_KEY (411): Invalid wallet private key


## License

This project is licensed under the ISC License.
