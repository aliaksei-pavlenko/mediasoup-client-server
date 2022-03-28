const mediasoup = require('mediasoup');
const http = require('http');
const io = require('socket.io')

const httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end();
}).listen(4444);


let senders = [];

mediasoup.createWorker()
    .then(worker=>{
        const socketApp = io(httpServer, {
            cors: {
                origin: '*',
            }
        });

        socketApp.on('connection',socket=>{
            const {role,name} = socket.handshake.query;
            if(role === 'sender'){
                senders.push({socket,role,name,consumers:[/* здесь сокеты того что хочет смотреть */]});
                socket.on('disconnect',()=>{senders = senders.filter(el=>el.name !== name)}); // убрать из массива senders
                senderChain({worker,socket,role,name});
            }
            if(role === 'consumer'){
                const streamerName = socket.handshake.query.wantToWatch;
                const streamer = senders.find(el=>el.name === streamerName);
                if(!streamer) {
                    socket.disconnect('This streamer not streaming');
                } else {
                    streamer.consumers.push({socket})
                    socket.on('disconnect',()=>{ streamer.consumers =  streamer.consumers.filter(el=>el.socket !== socket)}); // убрать из массива senders
                    consumerChain({streamerRouter:streamer.router,socket,producerId:streamer.producerId});
                }
            }
        })
    })

async function senderChain({worker,socket,role,name}){
    
    const mediaCodecs = [
        {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
        },
        {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
        }
    ]

    const router = await worker.createRouter({mediaCodecs});
    const sender = senders.find(el=>el.name === name);
    sender.router = router;

    await new Promise(res=>{
        socket.on('ready-for-router-capabilities',()=>{
            socket.emit('router-rtp-capabilities',{routerRtpCapabilities:router.rtpCapabilities})
            socket.on('im-load-routerRtpCapabilities',res);
        });
    })

    const transportOptions = {
        listenIps : [ { ip: "127.0.0.1" } ],
        enableUdp : true,
        enableTcp : true,
        preferUdp : true
    }
    const transport = await router.createWebRtcTransport(transportOptions);

    const transportMeta = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    }

    socket.emit('server-transport-created',transportMeta)

    /*  */
    await new Promise(res=>{
        socket.on('dtls-from-client-sender-transport',dtls=>{
            res(transport.connect(dtls)/* async - ничем не резолвиться - просто подождать */)
        })
    })
    .then(()=>{
        return new Promise(res=>{
            socket.emit('dtls-from-client-sender-transport-attached')
            socket.on('kind-and-rtpParams-from-client-sender-transport',({kind,rtpParameters})=>{
                res(transport.produce({kind,rtpParameters}))
            })
        })
    })
    .then(producer=>{
        sender.producerId = producer.id; /* он потом у зрителя нуже для проверки совместимости producer и consumer и создания consumer */
        socket.emit('producer-created-on-server-transport',producer.id)
    })
}


async function consumerChain({streamerRouter,socket,producerId}){

    await new Promise(res=>{
        socket.on('ready-for-router-capabilities',()=>{
            socket.emit('router-rtp-capabilities',{routerRtpCapabilities:streamerRouter.rtpCapabilities})
            socket.on('im-load-routerRtpCapabilities',res);
        });
    })

    const transportOptions = {
        listenIps : [ { ip: "127.0.0.1" } ],
        enableUdp : true,
        enableTcp : true,
        preferUdp : true
    }
    const transport = await streamerRouter.createWebRtcTransport(transportOptions);

    const transportMeta = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    }

    socket.emit('server-transport-created',transportMeta)

    /* подписываюсь но не жду потому что это затригериться после следущего шага */
    new Promise(res=>{
        socket.on('dtls-from-client-consumer-transport',dtls=>{
            res(transport.connect(dtls)/* async - ничем не резолвиться - просто подождать */)
        })
    })
    .then(()=>{
        socket.emit('dtls-from-client-consumer-transport-attached') // готов передавать данные
    })
    /*  */

    await new Promise (res=>{
        socket.on('client-rtp-capabilities',({rtpCapabilities})=>{
            if(streamerRouter.canConsume({producerId,rtpCapabilities})){
                res(transport.consume({
                    producerId,
                    rtpCapabilities,
                    paused: true, /* там в доках сказано что надо запаузить - */
                }))
            }
        })
    })
    .then(consumer=>{
        socket.on('unpause-consumer', () => {
            consumer.resume()
        })

        socket.emit('server-consumer-meta',{
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
        })
    })
}






