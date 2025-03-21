# How To Publish Data Using DPSN

## Prerequisites

- DPSN URL: betanet.dpsn.org
- DPSN Smart Contract Address: 0xC4c4CFCB2EDDC26660850A4f422841645941E352 (on Base Sepolia testnet)
- Wallet private key: Your private key for a wallet on Base chain
- RPC URL: URL from any Base testnet RPC provider
- Minimum balance: 0.002 Base ETH to register a topic

## 🛠️ Installation

Install the DPSN library from npm:

```shell
npm install dpsn-client@latest
```

## Implementation Steps

> **Caution:** Ensure you're using the appropriate DPSN URL, Base RPC, and Base wallet private key

> **Note:** You can create a MetaMask wallet, switch to Base chain, and obtain Sepolia Base ETH from the testnet faucet

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

### Disconnect

> For properly terminating the connection when needed

```ts
await dpsnClient.disconnect();
```
