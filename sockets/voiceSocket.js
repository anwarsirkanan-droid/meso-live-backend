// src/hooks/useWebRTC.js
import { useCallback, useEffect, useRef, useState } from 'react';
import socket from '../socket.js';
import { getIceServers } from '../services/iceServers.js';

export default function useWebRTC({ roomId, localStream, seated }) {
  const [remoteStreams, setRemoteStreams] = useState({}); // { socketId: MediaStream }
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }

  const createPeer = useCallback((peerSocketId, initiator) => {
    if (peersRef.current[peerSocketId]) return peersRef.current[peerSocketId];

    const peer = new RTCPeerConnection({ iceServers: getIceServers() });

    // Send local audio
    localStream?.getTracks().forEach((track) => peer.addTrack(track, localStream));

    // Receive remote audio
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStreams((prev) => ({ ...prev, [peerSocketId]: remoteStream }));
    };

    // Send ICE candidates — socket ID target
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice_candidate', {
          target: peerSocketId,
          candidate: event.candidate,
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[peerSocketId];
          return next;
        });
        peer.close();
        delete peersRef.current[peerSocketId];
      }
    };

    peersRef.current[peerSocketId] = peer;

    // Initiator creates + sends offer
    if (initiator) {
      peer.onnegotiationneeded = async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit('voice_offer', { target: peerSocketId, offer });
        } catch (err) {
          console.error('Offer Error:', err);
        }
      };
    }

    return peer;
  }, [localStream]);

  // Handle incoming signals — event names backend waliin wal simbaa
  useEffect(() => {
    if (!seated || !localStream) return;

    // Existing user initiates offer to new joiner
    const onUserJoined = ({ socketId }) => {
      if (socketId === socket.id) return;
      createPeer(socketId, true);
    };

    // New joiner answers
    const onVoiceOffer = async ({ socketId, offer }) => {
      if (socketId === socket.id) return;
      const peer = createPeer(socketId, false);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('voice_answer', { target: socketId, answer });
    };

    const onVoiceAnswer = async ({ socketId, answer }) => {
      const peer = peersRef.current[socketId];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const onIceCandidate = async ({ socketId, candidate }) => {
      const peer = peersRef.current[socketId];
      if (peer && candidate) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('ICE Error:', err);
        }
      }
    };

    const onUserLeft = ({ socketId }) => {
      const peer = peersRef.current[socketId];
      if (peer) {
        peer.close();
        delete peersRef.current[socketId];
      }
      setRemoteStreams((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    };

    socket.on('user-joined', onUserJoined);
    socket.on('voice_offer', onVoiceOffer);
    socket.on('voice_answer', onVoiceAnswer);
    socket.on('ice_candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);

    return () => {
      socket.off('user-joined', onUserJoined);
      socket.off('voice_offer', onVoiceOffer);
      socket.off('voice_answer', onVoiceAnswer);
      socket.off('ice_candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
    };
  }, [seated, localStream, createPeer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach((peer) => peer.close());
      peersRef.current = {};
    };
  }, []);

  // Mute/unmute local audio
  const setMuted = useCallback((muted) => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [localStream]);

  return { remoteStreams, setMuted };
}