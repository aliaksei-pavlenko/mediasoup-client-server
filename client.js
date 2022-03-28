const mediasoupClient = require('mediasoup-client');
const io = require('socket.io-client');

window.mediasoupClient = mediasoupClient;

let socket;

function connectToSoket(){
    socket = io('http://localhost:4444',{
        query: {
            role: 'sender',
            name: 'alex'
        }
    });
    return new Promise(res=>{socket.on('connect',res)})
}

connectToSoket()
    .then(()=>{
        console.log('connected to socket')
    })
    .then(async ()=>{
        socket.emit('ready-for-router-capabilities');
        socket.on('router-rtp-capabilities',(routerRtpCapabilities)=>{
            console.log(routerRtpCapabilities)
            window.mediasoupDevice = new mediasoupClient.Device();
            window.mediasoupDevice.load(routerRtpCapabilities);
            socket.emit('im-load-routerRtpCapabilities')
        });
        

        const serverTransportParams =  await new Promise(res=>{
            socket.on('server-transport-created',res)
        })
        console.log(serverTransportParams)
        const localTransport = window.mediasoupDevice.createSendTransport(serverTransportParams);

        console.log(localTransport)

        
        const constraints = {video:{width:{min:1920},height:{min:1080}}}
        const videoMediaStreamTrack = await navigator.mediaDevices.getUserMedia(constraints).then(mediaStream=>{
            const video = document.createElement('video');
            video.autoplay = true; 
            video.style.display = 'block'; video.style.width = '100%'; 
            video.srcObject = mediaStream;
            document.body.append(video)

            return mediaStream.getVideoTracks()[0];
        })

        console.log(videoMediaStreamTrack)

        
        localTransport.on('connect',async (dtls,callback,errcallback)=>{
            /* тут странная система 3 агрумента 1 - объект, 2 - callback - вызвать после того как в трансорт на сервере будет передан 1 ый аргумент и */
            console.log('CONNECT event on local transport')
            await new Promise(res=>{
                socket.emit('dtls-from-client-sender-transport',dtls)
                socket.on('dtls-from-client-sender-transport-attached',res)
            })
            .then(callback /* trigger produce event below */)
        })
        
        localTransport.on('produce',async ({kind,rtpParameters},callback,errcallback)=>{
            console.log('PRODUCE event on local transport');
            await new Promise(res=>{
                socket.emit('kind-and-rtpParams-from-client-sender-transport',{kind,rtpParameters})
                socket.on('producer-created-on-server-transport',res/* server producer id */)
            })
            .then(callback /* вызывается с server producer id */)
        })

        localTransport.produce({track:videoMediaStreamTrack})

        /*  */
        
    })


/* consumer - viewer */
function connectToSoketAsConsumer(){
    const socket = io('http://localhost:4444',{
        query: {
            role: 'consumer',
            wantToWatch: 'alex', 
        }
    });
    return new Promise(res=>{socket.on('connect',()=>{res(socket)})})
}

function connectViewer(){
    let socket;
    return connectToSoketAsConsumer()
        .then(_socket=>{
            socket = _socket;
            console.log('connected to socket')
            return new mediasoupClient.Device();
        })
        .then( async (mediasoupClientDevice) => {


            await new Promise(res=>{
                socket.emit('ready-for-router-capabilities');
                socket.on('router-rtp-capabilities',(routerRtpCapabilities)=>{
                    console.log(routerRtpCapabilities)
                    mediasoupClientDevice.load(routerRtpCapabilities);
                    socket.emit('im-load-routerRtpCapabilities')
                    res();
                });
            })

            const serverTransportParams =  await new Promise(res=>{
                socket.on('server-transport-created',res)
            })
            console.log(serverTransportParams)
            const localTransport = window.mediasoupDevice.createRecvTransport(serverTransportParams);

            console.log(localTransport)

            /*  */
            localTransport.on('connect',async (dtls,callback,errcallback)=>{
                console.log('CONNECT event on local transport')
                await new Promise(res=>{
                    socket.emit('dtls-from-client-consumer-transport',dtls)
                    socket.on('dtls-from-client-consumer-transport-attached',res)
                })
                .then(callback /* как я понимаю тригерит непосредственно получение данных - видео */)
                .then(()=>{
                    socket.emit('unpause-consumer');
                })
            })

            socket.emit('client-rtp-capabilities',{rtpCapabilities:mediasoupClientDevice.rtpCapabilities})

            /*  */
            new Promise(res=>{
                socket.on('server-consumer-meta',({id,producerId,kind,rtpParameters})=>{
                    res(localTransport.consume({id,producerId,kind,rtpParameters})/* затрегирит connect event */)
                })
            })
            .then(consumer=>{/* на этом шаге будет уже доступен MediaStreamTrack */
                const {track} = consumer;
                const video = document.createElement('video');
                video.autoplay = true;
                video.style.display = 'block'; video.style.width = '100%';
                video.srcObject = new MediaStream([track]);
                document.body.append(video);
            })

        })
}

window.connectViewer = connectViewer;
