# How to publish to a data stream
### 1 Installation
 Install the DPSN client package in your project:
 
  ``` npm install dpsn-client```
### 2 Configure your DPSN Client

Create a new file dpsn-integration.js and add the following configuration:

```ts
import {DpsnClient} from 'dpsn-client';
//Initialize dpsnClient
const dpsnClient = new DpsnClient("betanet.dpsn.org", "ACCESS_TOKEN");

//Event handlers  - Monitor connection status.
dpsnClient.on('connect', (res) => {
  console.log('[CONNECT LOG]', res);
});
dpsnClient.on('error', (error) => {
  console.log('[ERROR LOG]', error);
});
dpsnClient.on('publish', (res) => {
  console.log('[PUBLISH LOG]', res);
});
```

### 3 Publish data

Publish data into your topic and build a data stream

```
(async () => {

//publish json/string data into your topic and build your data stream

await dpsnClient.publish("topicId", '<YOUR_CUSTOM_DATA>');

})();
```
