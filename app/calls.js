/* EDEN voice calls (WebRTC). Signalling goes through the database (call_signals table);
   the audio itself flows directly phone-to-phone. Works while the app is open on both phones. */
(function () {
  const RING_MS = 45000;
  const STALE_MS = 60000;

  class CallManager {
    // signal: { send({to, callId, kind, payload}), clear(callId) }
    constructor({ signal, onState, iceServers }) {
      this.signal = signal;
      this.onState = onState || (() => {});
      this.iceServers = iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
      this.state = { phase: 'idle' };
      this._reset();
    }

    _reset() {
      this.pc = null; this.stream = null; this.callId = null; this.peerId = null;
      this.pendingOffer = null; this.iceBuf = []; this.remoteSet = false;
      this.muted = false; this.seconds = 0;
      clearTimeout(this.ringTimer); clearInterval(this.tick);
    }

    _set(patch) {
      this.state = { ...this.state, ...patch };
      this.onState({ ...this.state });
    }

    _audioEl() {
      if (!this.audio) { this.audio = document.createElement('audio'); this.audio.autoplay = true; this.audio.setAttribute('playsinline', ''); document.body.appendChild(this.audio); }
      return this.audio;
    }

    async _mic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Calls need a secure (https) connection');
      try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
      catch (e) { throw new Error('Microphone is blocked. Allow it in your browser settings to make calls.'); }
    }

    _makePc() {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
      pc.onicecandidate = e => { if (e.candidate) this.signal.send({ to: this.peerId, callId: this.callId, kind: 'ice', payload: e.candidate.toJSON() }).catch(() => {}); };
      pc.ontrack = e => { const a = this._audioEl(); a.srcObject = e.streams[0]; a.play && a.play().catch(() => {}); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') this._connected();
        else if (['failed', 'closed'].includes(pc.connectionState)) this._end('Call dropped', false);
        else if (pc.connectionState === 'disconnected') setTimeout(() => { if (this.pc === pc && pc.connectionState === 'disconnected') this._end('Call dropped', true); }, 6000);
      };
      this.pc = pc;
      return pc;
    }

    _connected() {
      if (this.state.phase === 'connected') return;
      clearTimeout(this.ringTimer);
      this.seconds = 0;
      this._set({ phase: 'connected', seconds: 0 });
      this.tick = setInterval(() => { this.seconds++; this._set({ seconds: this.seconds }); }, 1000);
    }

    async start(peerId, peerName) {
      if (!['idle', 'ended'].includes(this.state.phase)) return;
      this._reset();
      this.peerId = peerId; this.callId = crypto.randomUUID();
      this._set({ phase: 'calling', peerId, peerName, callId: this.callId, seconds: 0, muted: false, reason: '' });
      try {
        this.stream = await this._mic();
        const pc = this._makePc();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.signal.send({ to: peerId, callId: this.callId, kind: 'offer', payload: { type: offer.type, sdp: offer.sdp } });
        this.ringTimer = setTimeout(() => this._end('No answer', true), RING_MS);
      } catch (e) { this._end(e.message || 'Could not start the call', true); }
    }

    async accept() {
      if (this.state.phase !== 'incoming' || !this.pendingOffer) return;
      clearTimeout(this.ringTimer);
      this._set({ phase: 'connecting' });
      try {
        this.stream = await this._mic();
        const pc = this._makePc();
        await pc.setRemoteDescription(this.pendingOffer);
        this.remoteSet = true;
        for (const c of this.iceBuf) await pc.addIceCandidate(c).catch(() => {});
        this.iceBuf = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signal.send({ to: this.peerId, callId: this.callId, kind: 'answer', payload: { type: answer.type, sdp: answer.sdp } });
      } catch (e) { this._end(e.message || 'Could not answer the call', true); }
    }

    decline() { if (this.state.phase === 'incoming') this._end('Declined', true, 'decline'); }
    hangup() { if (this.state.phase !== 'idle') this._end('Call ended', true); }

    toggleMute() {
      this.muted = !this.muted;
      if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
      this._set({ muted: this.muted });
    }

    async handleSignal(row, peerNameFor) {
      if (Date.now() - new Date(row.created_at).getTime() > STALE_MS) return;
      if (row.kind === 'offer') {
        if (!['idle', 'ended'].includes(this.state.phase)) { this.signal.send({ to: row.from_user, callId: row.call_id, kind: 'decline', payload: { busy: true } }).catch(() => {}); return; }
        this._reset();
        this.peerId = row.from_user; this.callId = row.call_id; this.pendingOffer = row.payload;
        this._set({ phase: 'incoming', peerId: row.from_user, peerName: peerNameFor ? peerNameFor(row.from_user) : 'Someone', callId: row.call_id, seconds: 0, muted: false, reason: '' });
        this.ringTimer = setTimeout(() => this._end('Missed call', false), RING_MS);
        return;
      }
      if (row.call_id !== this.callId) return;
      if (row.kind === 'answer' && this.pc && !this.remoteSet) {
        await this.pc.setRemoteDescription(row.payload);
        this.remoteSet = true;
        for (const c of this.iceBuf) await this.pc.addIceCandidate(c).catch(() => {});
        this.iceBuf = [];
        this._set({ phase: 'connecting' });
      } else if (row.kind === 'ice') {
        if (this.pc && this.remoteSet) await this.pc.addIceCandidate(row.payload).catch(() => {});
        else this.iceBuf.push(row.payload);
      } else if (row.kind === 'hangup') this._end('Call ended', false);
      else if (row.kind === 'decline') this._end(row.payload && row.payload.busy ? 'Busy on another call' : 'Declined', false);
    }

    _end(reason, notify, kind) {
      if (this.state.phase === 'idle') return;
      const id = this.callId, peer = this.peerId;
      if (notify && peer && id) this.signal.send({ to: peer, callId: id, kind: kind || 'hangup', payload: {} }).catch(() => {});
      if (this.pc) { try { this.pc.close(); } catch (e) {} }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.audio) this.audio.srcObject = null;
      this._reset();
      this._set({ phase: 'ended', reason });
      if (id) setTimeout(() => this.signal.clear(id), 5000);
      setTimeout(() => { if (this.state.phase === 'ended') this._set({ phase: 'idle', reason: '' }); }, 2200);
    }
  }

  window.EdenCalls = { CallManager };
})();
