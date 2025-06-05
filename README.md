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

- DPSN URL: Your DPSN broker URL (e.g., betanet.dpsn.org)
- DPSN Access Token: Your private key for authentication

### Import the Library

```ts
import {DpsnClient} from 'dpsn-client';
```

### Create Client Instance

```ts
// With SSL (mqtts://)
const dpsnClient = new DpsnClient('<dpsn_url>', '<dpsn_access_token>', true);

// Without SSL (mqtt://)
const dpsnClient = new DpsnClient('<dpsn_url>', '<dpsn_access_token>', false);

// Default behavior (client defaults to mqtts://)
const dpsnClient = new DpsnClient('<dpsn_url>', '<dpsn_access_token>');
```

### Understanding DPSN Topics

Topics in DPSN are data distribution channels that enable secure data streams. They function as:

- **Data streams**: Publishers push data to topics, and subscribers receive data from topics
- **Authenticated channels**: Authentication is provided through cryptographic signatures

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

```ts
await dpsnClient.init()
```

### Publish Data

```ts
await dpsnClient.publish('<topic>', <data>);
```

### Subscribing to Topics

To subscribe to a topic and handle incoming messages, use the [`subscribe`](src/index.ts) method:

```ts
await dpsnClient.subscribe('<topic>', (message) => {
  console.log("Received message:", message);
});
```

### Unsubscribing from Topics

To unsubscribe from a topic when you no longer want to receive messages, use the [`unsubscribe`](src/index.ts) method:

```ts
const result = await dpsnClient.unsubscribe('<topic>');
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
constructor(dpsnUrl: string, dpsn_accestoken: string, ssl?: boolean)
```

Parameters:
- `dpsnUrl` - The DPSN broker URL
- `dpsn_accestoken` - Your private key for authentication
- `ssl` - Optional. If `true`, forces `mqtts://`. If `false`, forces `mqtt://`. If not provided, uses the protocol from the URL.

##### Methods

- [`init(options?: InitOptions): Promise<MqttClient>`](src/index.ts) - Initialize the DPSN client and connect to the broker
- [`on(event: DpsnEventType, callback: Function): this`](src/index.ts) - Register event handlers for various events (connect, subscription, publish, disconnect, error)
- [`onConnect(callback: (message: string) => void): void`](src/index.ts) - *Deprecated*: Register a callback for connection events (use `on('connect', callback)` instead)
- [`onError(callback: (error: Error | DPSNError) => void): void`](src/index.ts) - *Deprecated*: Register a callback for error events (use `on('error', callback)` instead)
- [`publish(topic: string, message: any, options?: Partial<mqtt.IClientPublishOptions>): Promise<void>`](src/index.ts) - Publish a message to a topic
- [`subscribe(topic: string, callback: (message: any) => void, options?: mqtt.IClientSubscribeOptions): Promise<void>`](src/index.ts) - Subscribe to a topic
- [`unsubscribe(topic: string): Promise<{topic: string, message: string}>`](src/index.ts) - Unsubscribe from a topic and stop receiving messages
- [`disconnect(): Promise<void>`](src/index.ts) - Disconnect from the MQTT broker and clean up resources

### Types

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
type DpsnEventType = 'connect' | 'subscription' | 'publish' | 'disconnect' | 'error';
```

#### [`DpsnEventData`](src/index.ts)

```ts
type DpsnEventData = {
  connect: string;
  subscription: { topic: string, qos: number };
  publish: { topic: string, messageId?: number };
  disconnect: void;
  error: Error | DPSNError;
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
- INVALID_PRIVATE_KEY (411): Invalid access token/private key
- MQTT_ERROR (413): MQTT protocol errors

## License

This project is licensed under the ISC License.
