import DpsnLib from '../src';

(async()=>{

  try{
    const dpsn = new DpsnLib("DPSN_URL","WALLET_PYT_KEY",{
      network:'testnet',
      blockchain:'ethereum',
      rpcUrl:"RPC_URL",
      isMainnet:false,
      isTestnet:true
    })
    
    dpsn.onConnect((res:any)=>console.log(res));

    dpsn.onError((error:any)=>{
      console.log("[Error LOG]",error);
    })
  


    await dpsn.init()

    await dpsn.subscribe("TOPIC_HASH",(res,parsedMessage,packetdetails)=>{
      console.log(parsedMessage);
    })


  }
  catch(error){
    console.log(error)
  }

  // process.exit(0)
  
})()