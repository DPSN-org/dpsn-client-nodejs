# How To Publish Data Using DPSN

## Pre-requisites:
- DPSN URL - (betanet.dpsn.org)
- Wallet private key - private key for wallet on base chain.
- RPC URL - rpc url from any provider of base testnet rpc nodes.
- Min balance of 0.002 base eth to register topic.

## 🛠️ Installation

- Install DPSN library from npmjs
```shell
npm install dpsn-client@latest
```
 
## Steps

> **Caution** Ensure you are using appropriate url for dpsn , base rpc and base wallet private key

> **Note:** You can create metamask wallet , change to network to base chain and get some base eth from base testnet faucet

### Import the library
```ts
import {DpsnClient} from 'dpsn-client';
```

### Create client instance
```ts
const dpsnClient = new DpsnClient(<dpsn_url>,<private_key>,{
  network:'testnet',
  wallet_chain_type:'ethereum',
})
```

### Configure blockchain config
```ts
dpsnClient.setBlockchainConfig(<base_rpc_url>,<contract_address>)
```

### Purchase Topic
> **Caution** Before you purchase topic make sure you have minimum balance of 0.002 base eth available otherwise blockchain transaction might fail.

```ts
const {receipt,topicHash} = await dpsnClient.purchaseTopic(<topic_name>);
```

### Setup Event Handlers
> **Note** This event handlers helps to handle events like connection, disconnection, publishing events and errors. always setup these handlers before init()
```ts
dpsnClient.on('connect',(res)=>{
  console.log(res);
})


dpsnClient.on('publish',(res)=>{
  console.log(res);
})

dpsnClient.on('subscription',(res)=>{
  console.log("STARTED SUBSCRIPTION:",res)
})

dpsnClient.on('disconnect',(res)=>{
  console.log(res);
})


dpsnClient.on('error',(err)=>{
  console.log("OPEREATION FAILED: ",err);
})

```

### Initialize DPSN client
> **Caution**: Make sure you have configured correct dpsn url and base wallet private key 

```ts
await dpsnClient.init()
```

### Publish
> **Caution**: Make sure you use same private key used purchase topic, othewise authentication will fail

```ts
await dpsnClient.publish(<topic_hash>,<data>);
```

### Disconnect
> Usefull incase of terminating connection
```ts
await dpsnClient.disconnect();
```
