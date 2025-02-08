# dpsn-client-nodejs

## Overview

`dpsn-client-nodejs` is an SDK for managing topic subscriptions and publications using MQTT and Ethereum blockchain. It allows you to connect to a DPSN broker, publish messages to topics, and subscribe to topics to receive messages.

## Installation

```sh
npm install dpsn-client-nodejs
```

## Usage

### Importing the Library

```ts
import DpsnLib from 'dpsn-client-nodejs';
```

### Initializing the Client

To initialize the DPSN client, create an instance of [`DpsnLib`](src/index.ts) 

```ts
const dpsn = new DpsnLib("DPSN_URL", "WALLET_PRIVATE_KEY", {
  network: 'testnet',
  blockchain: 'ethereum',
  rpcUrl: "RPC_URL",
  isMainnet: false,
  isTestnet: true
});


```
To listen to the dpsn broker connection status , use 
```ts
dpsn.onConnect((res: any) => console.log(res));
```
For logging errors , use 

```ts
dpsn.onError((error: any) => console.log("[Error LOG]", error));
```

### Connecting to the DPSN Broker

The `init` method initiates connection  to the DPSN broker.

```ts
await dpsn.init();
```
### Purchasing a Topic

To register a new topic in the dpsn infrastructure,  
The first step is to set the valid dpsn contract address using the `setContractAddress` method,
```ts
dpsn.setContractAddress("CONTRACT_ADDRESS");
```
Then  call the purchaseTopic method to register your topic name on-chain.
```ts
const { receipt, topicHash } = await dpsn.purchaseTopic("TOPIC_NAME");
console.log("Purchased topic:", topicHash);
```;

### Setting Contract Address

To set the contract address for interacting with the smart contract, use the [`setContractAddress`](src/index.ts) method.
[`purchaseTopic`](src/index.ts)

### Publishing Messages

To publish a message to a topic, use the [`publish`](src/index.ts) method.

```ts
await dpsn.publish("TOPIC_HASH", { key: "value" });
```

### Subscribing to Topics

To subscribe to a topic and handle incoming messages, use the [`subscribe`](src/index.ts) method.

```ts
await dpsn.subscribe("TOPIC_HASH", (topic, message, packet) => {
  console.log("Received message:", message);
});
```

### Fetching Owned Topics

To fetch the topics owned by the user, use the [`fetchOwnedTopics`](src/index.ts) method.

```ts
const topics = await dpsn.fetchOwnedTopics();
console.log("Owned topics:", topics);
```

### Fetching Topic Price

To fetch the current price of purchasing topic in the dpsn infrastructure, use the [`getTopicPrice`](src/index.ts) method.

```ts
const price = await dpsn.getTopicPrice();
console.log("Topic price:", price);
```



## API Reference

### Classes

#### [`DpsnLib`](src/index.ts)

##### Constructor

```ts
constructor(dpsnUrl: string, privateKey: string, chainOptions: ChainOptions)
```

##### Methods

- [`init(options?: InitOptions): Promise<MqttClient>`](src/index.ts)
- [`onConnect(callback: any): void`](src/index.ts)
- [`onError(callback: any): void`](src/index.ts)
- [`publish(topic: string, message: any, options?: Partial<mqtt.IClientPublishOptions>): Promise<void>`](src/index.ts)
- [`subscribe(topic: string, callback: (topic: string, message: any, packet?: mqtt.IPublishPacket) => void, options?: mqtt.IClientSubscribeOptions): Promise<void>`](src/index.ts)
- [`fetchOwnedTopics(): Promise<string[]>`](src/index.ts)
- [`getTopicPrice(): Promise<ethers.BigNumberish>`](src/index.ts)
- [`purchaseTopic(topicName: string): Promise<{ receipt: ethers.TransactionReceipt; topicHash: string }>`](src/index.ts)
- [`setContractAddress(contractAddress: string): void`](src/index.ts)

### Types

#### [`ChainOptions`](src/index.ts)

```ts
interface ChainOptions {
  network: NetworkType;
  blockchain: string;
  rpcUrl: string;
  isMainnet: boolean;
  isTestnet: boolean;
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

#### [`DPSNError`](src/index.ts)

```ts
interface DPSNError {
    code?: string;
    message?: string;
    status?: 'connected' | 'disconnected';
}

### Error Codes
DPSN_CONNECTION_ERROR
DPSN_PUBLISH_ERROR
DPSN_CLIENT_NOT_INITIALIZED
DPSN_CLIENT_NOT_CONNECTED
DPSN_SUBSCRIBE_ERROR
DPSN_SUBSCRIBE_NO_GRANT
DPSN_SUBSCRIBE_SETUP_ERROR


## License

This project is licensed under the ISC License.