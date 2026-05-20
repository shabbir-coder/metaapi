const { Server } = require('socket.io');
const mongoose = require('mongoose');
const crypto = require('crypto');

const socketSessionSchema = new mongoose.Schema({
    mongoId: { type: String, unique: true },
    socketId: String,
    token: { type: String, unique: true },
    lastActive: { type: Date, default: Date.now }
});
const SocketSession = mongoose.model("SocketSession", socketSessionSchema);

let io;
const connectedClients = {}; // Store active clients { instanceId: socketId }

const initializeSocket = (server) => {
    
    // console.log('server',server)
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        path: "/metaapi/socket.io/",
    });
    

    io.on("connection", async (socket) => {
        console.log("A user connected:", socket.id);
        let { token } = socket.handshake.auth || {};
        let session = null;

        console.log('token', token);

        if (token) {
            // Find existing session
            try {
                session = await SocketSession.findOne({ token });
                if (session) {
                    console.log(`Restoring session for mongoId ${session.mongoId}`);
                    // const oldSocket = io.sockets.sockets.get(session.socketId);
                    // if (oldSocket && oldSocket.connected) {
                    //     console.log(`Disconnecting old socket: ${session.socketId}`);
                    //     oldSocket.disconnect(true);
                    // }
                    
                    session.socketId = socket.id;
                    session.lastActive = new Date();
                    await session.save();
                }
            } catch (error) {
                console.error('Error finding session:', error);
            }
        }

        socket.on("registerInstance", async ({ mongoId }) => {
            console.log(`Registering instance: ${mongoId}`);

            try {
                let existingSession = await SocketSession.findOne({ mongoId });

                if (existingSession) {
                    console.log(`Updating existing session for mongoId: ${mongoId} with ${socket.id}`);
                //     const oldSocket = io.sockets.sockets.get(existingSession.socketId);
                //   if (oldSocket && oldSocket.connected) {
                //         console.log(`Disconnecting old socket: ${existingSession.socketId}`);
                //         oldSocket.disconnect();
                //     }
                    existingSession.socketId = socket.id;
                    existingSession.lastActive = new Date();
                    await existingSession.save();
                    socket.emit("sessionToken", existingSession.token);
                } else {
                    console.log(`No existing session, creating new one for ${mongoId}`);

                    token = crypto.randomBytes(16).toString("hex");
                    session = new SocketSession({ mongoId, socketId: socket.id, token });
                    await session.save();
                    socket.emit("sessionToken", token);
                }
            } catch (error) {
                console.error('Error registering instance:', error);
            }
        });

        socket.on("disconnect", async () => {
            console.log(`User disconnected: ${socket.id}`);
            if (session) {
                session.lastActive = new Date();
                try {
                    await session.save();
                } catch (error) {
                    console.error('Error saving session on disconnect:', error);
                }
            }
        });

        socket.on("reconnect_attempt", (attempt) => {
            console.log(`Client attempting to reconnect with server (Attempt: ${attempt})`);
        });

        socket.on("reconnect_failed", () => {
            console.error("Client failed to reconnect.");
        });
    });

    return io;
};

const emitToInstance = async (mongoId, eventName, data) => {
    try {
        const session = await SocketSession.findOne({ mongoId });
        console.log('session', session);
        if (session) {
            io.to(session.socketId).emit(eventName, data);
        } else {
            console.log(`EventId ${mongoId} is not online.`);
        }
    } catch (error) {
        console.error('Error emitting to instance:', error);
    }
};

const getSocketInstance = () => io;

module.exports = { initializeSocket, getSocketInstance, emitToInstance };