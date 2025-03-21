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

### Purchase Topic

> **Caution:** Ensure you have a minimum balance of 0.002 Base ETH available to prevent transaction failure

```ts
const {receipt, topicHash} = await dpsnClient.purchaseTopic(<topic_name>);
```
- `receipt`: Transaction receipt from the blockchain
- `topicHash`: Unique topic name owned by the wallet that executed the transaction

> **Note:** Only the wallet that purchased the topic can publish to it

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
