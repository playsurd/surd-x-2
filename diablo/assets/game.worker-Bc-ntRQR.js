(function() {
	async function e(e = {}) {
		var t = e, r = !!globalThis.window, n = !!globalThis.WorkerGlobalScope;
		globalThis.process?.versions?.node && globalThis.process;
		var a, o = (e, t) => {
			throw t;
		}, i = (self.__DBASE+"assets/w.js"), s = "";
		if (r || n) {
			try {
				s = new URL(".", i).href;
			} catch {}
			n && (a = (e) => {
				var t = new XMLHttpRequest();
				return t.open("GET", e, !1), t.responseType = "arraybuffer", t.send(null), new Uint8Array(t.response);
			});
		}
		var c, u, l = console.log.bind(console), f = console.error.bind(console), p = !1;
		class d {}
		class h extends d {
			constructor(e) {
				super(), this.excPtr = e;
			}
		}
		const w = 34821223, y = 2310721022;
		function b(e) {
			return "0x" + (e >>> 0).toString(16).padStart(8, "0");
		}
		function _() {
			if (!p) {
				var e = ce();
				0 == e && (e += 4);
				var t, r = A[e >> 2], n = A[e + 4 >> 2];
				r == w && n == y || x(`Stack overflow! Stack cookie has been overwritten at ${t = e, "0x" + (t >>>= 0).toString(16).padStart(8, "0")}, expected hex dwords ${b(y)} and ${b(w)}, but received ${b(n)} ${b(r)}`), 1668509029 != A[0] && x("Runtime error: The application has corrupted its heap memory area (address zero)!");
			}
		}
		var m, g, v, A, S = !1;
		function D() {
			if (!v?.buffer?.resizable) {
				var e = de.buffer;
				v = new Int8Array(e), t.HEAPU8 = P = new Uint8Array(e), g = new Int32Array(e), t.HEAPU32 = A = new Uint32Array(e), Q = new Float32Array(e), N = new Float64Array(e), O = new BigInt64Array(e);
			}
		}
		function x(e) {
			throw t.onAbort?.(e), f(e = `Aborted(${e})`), p = !0, e += ". Build with -sASSERTIONS for more info.", new WebAssembly.RuntimeError(e);
		}
		function k() {
			return t.locateFile ? s + "Diablo.wasm" : (self.__DBASE+"assets/Diablo.wasm");
		}
		function T(e, t) {
			var r, n = function(e) {
				if (e == m && c) return new Uint8Array(c);
				if (a) return a(e);
				throw "sync fetching of the wasm failed: you can preload it to Module[\"wasmBinary\"] manually, or emcc.py will do that for you when generating HTML (but not JS)";
			}(e);
			return r = new WebAssembly.Module(n), [new WebAssembly.Instance(r, t), r];
		}
		class E {
			name = "ExitStatus";
			constructor(e) {
				this.message = `Program terminated with exit(${e})`, this.status = e;
			}
		}
		var C = (e) => {
			for (; e.length > 0;) e.shift()(t);
		}, I = [], L = [], R = !0;
		var P, U = globalThis.TextDecoder && new TextDecoder(), M = (e, t = 0, r, n) => {
			var a = ((e, t, r, n) => {
				var a = t + r;
				if (n) return a;
				for (; e[t] && !(t >= a);) ++t;
				return t;
			})(e, t, r, n);
			if (a - t > 16 && e.buffer && U) return U.decode(e.subarray(t, a));
			for (var o = ""; t < a;) {
				var i = e[t++];
				if (128 & i) {
					var s = 63 & e[t++];
					if (192 != (224 & i)) {
						var c = 63 & e[t++];
						if ((i = 224 == (240 & i) ? (15 & i) << 12 | s << 6 | c : (7 & i) << 18 | s << 12 | c << 6 | 63 & e[t++]) < 65536) o += String.fromCharCode(i);
						else {
							var u = i - 65536;
							o += String.fromCharCode(55296 | u >> 10, 56320 | 1023 & u);
						}
					} else o += String.fromCharCode((31 & i) << 6 | s);
				} else o += String.fromCharCode(i);
			}
			return o;
		}, $ = (e, t, r) => e ? M(P, e, t, r) : "", W = null;
		class B {
			constructor(e) {
				this.excPtr = e, this.ptr = e - 24;
			}
			set_type(e) {
				A[this.ptr + 4 >> 2] = e;
			}
			get_type() {
				return A[this.ptr + 4 >> 2];
			}
			set_destructor(e) {
				A[this.ptr + 8 >> 2] = e;
			}
			get_destructor() {
				return A[this.ptr + 8 >> 2];
			}
			set_caught(e) {
				e = e ? 1 : 0, v[this.ptr + 12] = e;
			}
			get_caught() {
				return 0 != v[this.ptr + 12];
			}
			set_rethrown(e) {
				e = e ? 1 : 0, v[this.ptr + 13] = e;
			}
			get_rethrown() {
				return 0 != v[this.ptr + 13];
			}
			init(e, t) {
				this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(t);
			}
			set_adjusted_ptr(e) {
				A[this.ptr + 16 >> 2] = e;
			}
			get_adjusted_ptr() {
				return A[this.ptr + 16 >> 2];
			}
		}
		var N, O, q = (e) => ie(e), j = 0, z = {}, H = (e) => {
			if (e instanceof E || "unwind" == e) return u;
			_(), e instanceof WebAssembly.RuntimeError && le() <= 0 && f("Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)"), o(0, e);
		}, F = () => R || j > 0, G = (e) => {
			u = e, F() || (p = !0), o(0, new E(e));
		}, K = (e, t) => {
			u = e, G(e);
		}, J = (e) => {
			if (!p) try {
				return e();
			} catch (t) {
				H(t);
			} finally {
				(() => {
					if (!F()) try {
						K(u);
					} catch (t) {
						H(t);
					}
				})();
			}
		}, V = [], X = (e, t, r) => {
			var n = ((e, t) => {
				var r;
				for (V.length = 0; r = P[e++];) {
					var n = 105 != r;
					t += (n &= 112 != r) && t % 8 ? 4 : 0, V.push(112 == r ? A[t >> 2] : 106 == r ? O[t >> 3] : 105 == r ? g[t >> 2] : N[t >> 3]), t += n ? 8 : 4;
				}
				return V;
			})(t, r);
			return we[e](...n);
		}, Y = (e, t) => Math.ceil(e / t) * t, Z = (e) => {
			var t = (e - de.buffer.byteLength + 65535) / 65536 | 0;
			try {
				return de.grow(t), D(), 1;
			} catch (r) {}
		};
		var Q, ee = [
			null,
			[],
			[]
		], te = (e, t) => {
			var r = ee[e];
			t && 10 !== t ? r.push(t) : ((1 === e ? l : f)(M(r)), r.length = 0);
		}, re = [];
		t.noExitRuntime && (R = t.noExitRuntime), t.print && (l = t.print), t.printErr && (f = t.printErr), t.wasmBinary && (c = t.wasmBinary), t.arguments && t.arguments, t.thisProgram && t.thisProgram;
		var ne = t.preInit;
		if (ne) for ("function" == typeof ne && (t.preInit = ne = [ne]); ne.length > 0;) ne.shift()();
		var ae, oe, ie, se, ce, ue, le, fe, pe, de, he, we = { 275150: (e) => {
			self.DApi.current_save_id(e);
		} };
		var ye = {
			K: (e, t, r, n) => x(`Assertion failed: ${$(e)}, at: ` + [
				t ? $(t) : "unknown filename",
				r,
				n ? $(n) : "unknown function"
			]),
			w: () => ((e) => {
				var t = W?.excPtr;
				if (!t) return q(0), 0;
				var r = new B(t);
				r.set_adjusted_ptr(t);
				var n = r.get_type();
				if (!n) return q(0), t;
				for (var a of e) {
					if (!a || a === n) break;
					var o = r.ptr + 16;
					if (pe(a, n, o)) return q(a), t;
				}
				return q(n), t;
			})([]),
			e: (e, t, r) => {
				throw new B(e).init(t, r), fe(e), W = new h(e), W;
			},
			v: (e) => {
				throw W || (W = new h(e)), W;
			},
			G: () => x(""),
			r: function() {
				self.DApi.close_keyboard();
			},
			f: function(e, t, r, n, a) {
				self.DApi.open_keyboard(e, t, r, n, a);
			},
			B: () => {
				R = !1, j = 0;
			},
			y: (e, t) => (z[e] && (clearTimeout(z[e].id), delete z[e]), t ? (z[e] = {
				id: setTimeout(() => {
					delete z[e], J(() => ae(e, performance.now()));
				}, t),
				timeout_ms: t
			}, 0) : 0),
			I: function(e, t, r) {
				self.DApi.create_sound(e, P.slice(t, t + r));
			},
			J: function(e, t, r, n, a) {
				self.DApi.create_sound_raw(e, Q.slice(t / 4, t / 4 + r * n), r, n, a);
			},
			a: function(e) {
				self.DApi.delete_sound(e);
			},
			j: function() {
				self.DApi.draw_begin();
			},
			t: function(e) {
				self.DApi.draw_belt(g.subarray(e / 4, e / 4 + 8));
			},
			g: function(e, t, r, n, a) {
				self.DApi.draw_blit(e, t, r, n, P.subarray(a, a + r * n * 4));
			},
			u: function(e, t, r, n) {
				self.DApi.draw_clip_text(e, t, r, n);
			},
			i: function() {
				self.DApi.draw_end();
			},
			m: function(e, t, r, n) {
				var a = P.indexOf(0, r), o = String.fromCharCode.apply(null, P.subarray(r, a));
				self.DApi.draw_text(e, t, o, n);
			},
			H: function(e, t) {
				self.DApi.duplicate_sound(e, t);
			},
			N: function() {
				self.DApi.exit_game();
			},
			o: function(e, t, r, n) {
				self.DApi.play_sound(e, t, r, n);
			},
			d: function(e, t) {
				self.DApi.set_cursor(e, t);
			},
			n: function(e, t) {
				self.DApi.set_volume(e, t);
			},
			b: function(e) {
				self.DApi.stop_sound(e);
			},
			k: function(e) {
				self.DApi.use_websocket(e);
			},
			L: function() {
				return self.DApi.websocket_closed();
			},
			M: function(e, t) {
				self.DApi.websocket_send(P.subarray(e, e + t));
			},
			l: (e, t, r) => X(e, t, r),
			F: () => Date.now(),
			z: (e) => {
				var t = P.length, r = 2147483648;
				if ((e >>>= 0) > r) return !1;
				for (var n = 1; n <= 4; n *= 2) {
					var a = t * (1 + .2 / n);
					if (a = Math.min(a, e + 100663296), Z(Math.min(r, Y(Math.max(e, a), 65536)))) return !0;
				}
				return !1;
			},
			c: K,
			s: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				self.DApi.exit_error(r);
			},
			D: (e) => 52,
			C: function(e, t, r, n) {
				var a;
				return t = (a = t) < -9007199254740992 || a > 9007199254740992 ? NaN : Number(a), 70;
			},
			E: (e, t, r, n) => {
				for (var a = 0, o = 0; o < r; o++) {
					var i = A[t >> 2], s = A[t + 4 >> 2];
					t += 8;
					for (var c = 0; c < s; c++) te(e, P[i + c]);
					a += s;
				}
				return A[n >> 2] = a, 0;
			},
			h: function(e, t, r, n) {
				var a = P.indexOf(0, e), o = String.fromCharCode.apply(null, P.subarray(e, a));
				self.DApi.get_file_contents(o, P.subarray(t, t + n), r);
			},
			q: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				return self.DApi.get_file_size(r);
			},
			x: function(e, t) {
				var r = le();
				try {
					return ((a = re[n = e]) || (re[n] = a = he.get(n)), a)(t);
				} catch (o) {
					if (ue(r), !(o instanceof d)) throw o;
					oe(1, 0);
				}
				var n, a;
			},
			A: G,
			p: function(e, t, r) {
				var n = P.indexOf(0, e), a = String.fromCharCode.apply(null, P.subarray(e, n));
				self.DApi.put_file_contents(a, P.slice(t, t + r));
			},
			O: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				self.DApi.remove_file(r);
			}
		};
		function be() {
			var e;
			se(), 0 == (e = ce()) && (e += 4), A[e >> 2] = w, A[e + 4 >> 2] = y, A[0] = 1668509029;
		}
		var _e, me, ge = (me = { a: ye }, m ??= k(), _e = T(m, me)[0], function(e) {
			t._DApi_SyncTextPtr = e.R, t._DApi_Init = e.S, t._DApi_Mouse = e.T, t._DApi_Key = e.U, t._DApi_Char = e.V, t._DApi_Render = e.W, t._DApi_SyncText = e.X, t._DApi_AllocPacket = e.Y, t._SNet_InitWebsocket = e.Z, t._SNet_WebsocketStatus = e._, ae = e.aa, oe = e.ba, ie = e.ca, se = e.da, ce = e.ea, ue = e.fa, le = e.ga, fe = e.ha, pe = e.ia, e.ja, de = e.P, he = e.$;
		}(ge = _e.exports), D(), ge);
		return await async function() {
			be(), function() {
				var e = t.preRun;
				e && ("function" == typeof e && (e = [e]), L.push(...e)), C(L);
			}();
			var e = t.setStatus;
			e && (e("Running..."), await new Promise((e) => setTimeout(e, 1)), setTimeout(e, 1, "")), p || (S = !0, _(), ge.Q(), _(), t.onRuntimeInitialized?.(), function() {
				_();
				var e = t.postRun;
				e && ("function" == typeof e && (e = [e]), I.push(...e)), C(I);
			}());
		}(), t.ready = new Promise(function(e, r) {
			delete t.then, t.onAbort = function(e) {
				r(e);
			};
			const n = function() {
				e(t);
			};
			var a;
			S ? n() : (a = n, I.push(a));
		}), t;
	}
	async function t(e = {}) {
		var t = e, r = !!globalThis.window, n = !!globalThis.WorkerGlobalScope;
		globalThis.process?.versions?.node && globalThis.process;
		var a, o = (e, t) => {
			throw t;
		}, i = (self.__DBASE+"assets/w.js"), s = "";
		if (r || n) {
			try {
				s = new URL(".", i).href;
			} catch {}
			n && (a = (e) => {
				var t = new XMLHttpRequest();
				return t.open("GET", e, !1), t.responseType = "arraybuffer", t.send(null), new Uint8Array(t.response);
			});
		}
		var c, u, l = console.log.bind(console), f = console.error.bind(console), p = !1;
		class d {}
		class h extends d {
			constructor(e) {
				super(), this.excPtr = e;
			}
		}
		const w = 34821223, y = 2310721022;
		function b(e) {
			return "0x" + (e >>> 0).toString(16).padStart(8, "0");
		}
		function _() {
			if (!p) {
				var e = ce();
				0 == e && (e += 4);
				var t, r = A[e >> 2], n = A[e + 4 >> 2];
				r == w && n == y || x(`Stack overflow! Stack cookie has been overwritten at ${t = e, "0x" + (t >>>= 0).toString(16).padStart(8, "0")}, expected hex dwords ${b(y)} and ${b(w)}, but received ${b(n)} ${b(r)}`), 1668509029 != A[0] && x("Runtime error: The application has corrupted its heap memory area (address zero)!");
			}
		}
		var m, g, v, A, S = !1;
		function D() {
			if (!v?.buffer?.resizable) {
				var e = de.buffer;
				v = new Int8Array(e), t.HEAPU8 = P = new Uint8Array(e), g = new Int32Array(e), t.HEAPU32 = A = new Uint32Array(e), Q = new Float32Array(e), N = new Float64Array(e), O = new BigInt64Array(e);
			}
		}
		function x(e) {
			throw t.onAbort?.(e), f(e = `Aborted(${e})`), p = !0, e += ". Build with -sASSERTIONS for more info.", new WebAssembly.RuntimeError(e);
		}
		function k() {
			return t.locateFile ? s + "DiabloSpawn.wasm" : (self.__DBASE+"assets/DiabloSpawn.wasm");
		}
		function T(e, t) {
			var r, n = function(e) {
				if (e == m && c) return new Uint8Array(c);
				if (a) return a(e);
				throw "sync fetching of the wasm failed: you can preload it to Module[\"wasmBinary\"] manually, or emcc.py will do that for you when generating HTML (but not JS)";
			}(e);
			return r = new WebAssembly.Module(n), [new WebAssembly.Instance(r, t), r];
		}
		class E {
			name = "ExitStatus";
			constructor(e) {
				this.message = `Program terminated with exit(${e})`, this.status = e;
			}
		}
		var C = (e) => {
			for (; e.length > 0;) e.shift()(t);
		}, I = [], L = [], R = !0;
		var P, U = globalThis.TextDecoder && new TextDecoder(), M = (e, t = 0, r, n) => {
			var a = ((e, t, r, n) => {
				var a = t + r;
				if (n) return a;
				for (; e[t] && !(t >= a);) ++t;
				return t;
			})(e, t, r, n);
			if (a - t > 16 && e.buffer && U) return U.decode(e.subarray(t, a));
			for (var o = ""; t < a;) {
				var i = e[t++];
				if (128 & i) {
					var s = 63 & e[t++];
					if (192 != (224 & i)) {
						var c = 63 & e[t++];
						if ((i = 224 == (240 & i) ? (15 & i) << 12 | s << 6 | c : (7 & i) << 18 | s << 12 | c << 6 | 63 & e[t++]) < 65536) o += String.fromCharCode(i);
						else {
							var u = i - 65536;
							o += String.fromCharCode(55296 | u >> 10, 56320 | 1023 & u);
						}
					} else o += String.fromCharCode((31 & i) << 6 | s);
				} else o += String.fromCharCode(i);
			}
			return o;
		}, $ = (e, t, r) => e ? M(P, e, t, r) : "", W = null;
		class B {
			constructor(e) {
				this.excPtr = e, this.ptr = e - 24;
			}
			set_type(e) {
				A[this.ptr + 4 >> 2] = e;
			}
			get_type() {
				return A[this.ptr + 4 >> 2];
			}
			set_destructor(e) {
				A[this.ptr + 8 >> 2] = e;
			}
			get_destructor() {
				return A[this.ptr + 8 >> 2];
			}
			set_caught(e) {
				e = e ? 1 : 0, v[this.ptr + 12] = e;
			}
			get_caught() {
				return 0 != v[this.ptr + 12];
			}
			set_rethrown(e) {
				e = e ? 1 : 0, v[this.ptr + 13] = e;
			}
			get_rethrown() {
				return 0 != v[this.ptr + 13];
			}
			init(e, t) {
				this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(t);
			}
			set_adjusted_ptr(e) {
				A[this.ptr + 16 >> 2] = e;
			}
			get_adjusted_ptr() {
				return A[this.ptr + 16 >> 2];
			}
		}
		var N, O, q = (e) => ie(e), j = 0, z = {}, H = (e) => {
			if (e instanceof E || "unwind" == e) return u;
			_(), e instanceof WebAssembly.RuntimeError && le() <= 0 && f("Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)"), o(0, e);
		}, F = () => R || j > 0, G = (e) => {
			u = e, F() || (p = !0), o(0, new E(e));
		}, K = (e, t) => {
			u = e, G(e);
		}, J = (e) => {
			if (!p) try {
				return e();
			} catch (t) {
				H(t);
			} finally {
				(() => {
					if (!F()) try {
						K(u);
					} catch (t) {
						H(t);
					}
				})();
			}
		}, V = [], X = (e, t, r) => {
			var n = ((e, t) => {
				var r;
				for (V.length = 0; r = P[e++];) {
					var n = 105 != r;
					t += (n &= 112 != r) && t % 8 ? 4 : 0, V.push(112 == r ? A[t >> 2] : 106 == r ? O[t >> 3] : 105 == r ? g[t >> 2] : N[t >> 3]), t += n ? 8 : 4;
				}
				return V;
			})(t, r);
			return we[e](...n);
		}, Y = (e, t) => Math.ceil(e / t) * t, Z = (e) => {
			var t = (e - de.buffer.byteLength + 65535) / 65536 | 0;
			try {
				return de.grow(t), D(), 1;
			} catch (r) {}
		};
		var Q, ee = [
			null,
			[],
			[]
		], te = (e, t) => {
			var r = ee[e];
			t && 10 !== t ? r.push(t) : ((1 === e ? l : f)(M(r)), r.length = 0);
		}, re = [];
		t.noExitRuntime && (R = t.noExitRuntime), t.print && (l = t.print), t.printErr && (f = t.printErr), t.wasmBinary && (c = t.wasmBinary), t.arguments && t.arguments, t.thisProgram && t.thisProgram;
		var ne = t.preInit;
		if (ne) for ("function" == typeof ne && (t.preInit = ne = [ne]); ne.length > 0;) ne.shift()();
		var ae, oe, ie, se, ce, ue, le, fe, pe, de, he, we = { 265598: (e) => {
			self.DApi.current_save_id(e);
		} };
		var ye = {
			K: (e, t, r, n) => x(`Assertion failed: ${$(e)}, at: ` + [
				t ? $(t) : "unknown filename",
				r,
				n ? $(n) : "unknown function"
			]),
			w: () => ((e) => {
				var t = W?.excPtr;
				if (!t) return q(0), 0;
				var r = new B(t);
				r.set_adjusted_ptr(t);
				var n = r.get_type();
				if (!n) return q(0), t;
				for (var a of e) {
					if (!a || a === n) break;
					var o = r.ptr + 16;
					if (pe(a, n, o)) return q(a), t;
				}
				return q(n), t;
			})([]),
			e: (e, t, r) => {
				throw new B(e).init(t, r), fe(e), W = new h(e), W;
			},
			v: (e) => {
				throw W || (W = new h(e)), W;
			},
			G: () => x(""),
			r: function() {
				self.DApi.close_keyboard();
			},
			f: function(e, t, r, n, a) {
				self.DApi.open_keyboard(e, t, r, n, a);
			},
			B: () => {
				R = !1, j = 0;
			},
			y: (e, t) => (z[e] && (clearTimeout(z[e].id), delete z[e]), t ? (z[e] = {
				id: setTimeout(() => {
					delete z[e], J(() => ae(e, performance.now()));
				}, t),
				timeout_ms: t
			}, 0) : 0),
			I: function(e, t, r) {
				self.DApi.create_sound(e, P.slice(t, t + r));
			},
			J: function(e, t, r, n, a) {
				self.DApi.create_sound_raw(e, Q.slice(t / 4, t / 4 + r * n), r, n, a);
			},
			a: function(e) {
				self.DApi.delete_sound(e);
			},
			j: function() {
				self.DApi.draw_begin();
			},
			t: function(e) {
				self.DApi.draw_belt(g.subarray(e / 4, e / 4 + 8));
			},
			g: function(e, t, r, n, a) {
				self.DApi.draw_blit(e, t, r, n, P.subarray(a, a + r * n * 4));
			},
			u: function(e, t, r, n) {
				self.DApi.draw_clip_text(e, t, r, n);
			},
			i: function() {
				self.DApi.draw_end();
			},
			m: function(e, t, r, n) {
				var a = P.indexOf(0, r), o = String.fromCharCode.apply(null, P.subarray(r, a));
				self.DApi.draw_text(e, t, o, n);
			},
			H: function(e, t) {
				self.DApi.duplicate_sound(e, t);
			},
			N: function() {
				self.DApi.exit_game();
			},
			o: function(e, t, r, n) {
				self.DApi.play_sound(e, t, r, n);
			},
			d: function(e, t) {
				self.DApi.set_cursor(e, t);
			},
			n: function(e, t) {
				self.DApi.set_volume(e, t);
			},
			b: function(e) {
				self.DApi.stop_sound(e);
			},
			k: function(e) {
				self.DApi.use_websocket(e);
			},
			L: function() {
				return self.DApi.websocket_closed();
			},
			M: function(e, t) {
				self.DApi.websocket_send(P.subarray(e, e + t));
			},
			l: (e, t, r) => X(e, t, r),
			F: () => Date.now(),
			z: (e) => {
				var t = P.length, r = 2147483648;
				if ((e >>>= 0) > r) return !1;
				for (var n = 1; n <= 4; n *= 2) {
					var a = t * (1 + .2 / n);
					if (a = Math.min(a, e + 100663296), Z(Math.min(r, Y(Math.max(e, a), 65536)))) return !0;
				}
				return !1;
			},
			c: K,
			s: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				self.DApi.exit_error(r);
			},
			D: (e) => 52,
			C: function(e, t, r, n) {
				var a;
				return t = (a = t) < -9007199254740992 || a > 9007199254740992 ? NaN : Number(a), 70;
			},
			E: (e, t, r, n) => {
				for (var a = 0, o = 0; o < r; o++) {
					var i = A[t >> 2], s = A[t + 4 >> 2];
					t += 8;
					for (var c = 0; c < s; c++) te(e, P[i + c]);
					a += s;
				}
				return A[n >> 2] = a, 0;
			},
			h: function(e, t, r, n) {
				var a = P.indexOf(0, e), o = String.fromCharCode.apply(null, P.subarray(e, a));
				self.DApi.get_file_contents(o, P.subarray(t, t + n), r);
			},
			q: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				return self.DApi.get_file_size(r);
			},
			x: function(e, t) {
				var r = le();
				try {
					return ((a = re[n = e]) || (re[n] = a = he.get(n)), a)(t);
				} catch (o) {
					if (ue(r), !(o instanceof d)) throw o;
					oe(1, 0);
				}
				var n, a;
			},
			A: G,
			p: function(e, t, r) {
				var n = P.indexOf(0, e), a = String.fromCharCode.apply(null, P.subarray(e, n));
				self.DApi.put_file_contents(a, P.slice(t, t + r));
			},
			O: function(e) {
				var t = P.indexOf(0, e), r = String.fromCharCode.apply(null, P.subarray(e, t));
				self.DApi.remove_file(r);
			}
		};
		function be() {
			var e;
			se(), 0 == (e = ce()) && (e += 4), A[e >> 2] = w, A[e + 4 >> 2] = y, A[0] = 1668509029;
		}
		var _e, me, ge = (me = { a: ye }, m ??= k(), _e = T(m, me)[0], function(e) {
			t._DApi_SyncTextPtr = e.R, t._DApi_Init = e.S, t._DApi_Mouse = e.T, t._DApi_Key = e.U, t._DApi_Char = e.V, t._DApi_Render = e.W, t._DApi_SyncText = e.X, t._DApi_AllocPacket = e.Y, t._SNet_InitWebsocket = e.Z, t._SNet_WebsocketStatus = e._, ae = e.aa, oe = e.ba, ie = e.ca, se = e.da, ce = e.ea, ue = e.fa, le = e.ga, fe = e.ha, pe = e.ia, e.ja, de = e.P, he = e.$;
		}(ge = _e.exports), D(), ge);
		return await async function() {
			be(), function() {
				var e = t.preRun;
				e && ("function" == typeof e && (e = [e]), L.push(...e)), C(L);
			}();
			var e = t.setStatus;
			e && (e("Running..."), await new Promise((e) => setTimeout(e, 1)), setTimeout(e, 1, "")), p || (S = !0, _(), ge.Q(), _(), t.onRuntimeInitialized?.(), function() {
				_();
				var e = t.postRun;
				e && ("function" == typeof e && (e = [e]), I.push(...e)), C(I);
			}());
		}(), t.ready = new Promise(function(e, r) {
			delete t.then, t.onAbort = function(e) {
				r(e);
			};
			const n = function() {
				e(t);
			};
			var a;
			S ? n() : (a = n, I.push(a));
		}), t;
	}
	function r(e, t, r) {
		let n = null, a = [], o = 0, i = null, s = !1, c = !1;
		const u = (e) => {
			s || (s = !0, r(e));
		}, l = () => {
			if (i = null, !n || !a || !a.length) return;
			const e = a.reduce((e, t) => e + t.byteLength, 3), t = new Uint8Array(e);
			t[0] = 0, t[1] = 255 & a.length, t[2] = a.length >> 8;
			let r = 3;
			for (const n of a) t.set(n, r), r += n.byteLength;
			n.send(t), a.length = 0, o = 0;
		}, f = () => {
			n && a && !i && (i = setTimeout(l, 20));
		};
		return async function(e, t) {
			const r = new WebSocket(e);
			r.binaryType = "arraybuffer";
			let n = null;
			r.addEventListener("message", ({ data: e }) => {
				n ? n(e) : t(e);
			});
			const a = () => {
				try {
					r.close();
				} catch {}
			};
			await new Promise((e, t) => {
				const n = setTimeout(() => {
					r.removeEventListener("error", o), a(), t(1);
				}, 15e3), o = () => {
					clearTimeout(n), a(), t(1);
				};
				r.addEventListener("error", o), r.addEventListener("open", () => {
					clearTimeout(n), r.removeEventListener("error", o), e();
				});
			}), await new Promise((e, t) => {
				const r = setTimeout(() => {
					n = null, a(), t(1);
				}, 5e3);
				n = (o) => {
					clearTimeout(r);
					const i = new Uint8Array(o);
					50 === i[0] && (n = null, 1 == (i[1] | i[2] << 8 | i[3] << 16 | i[4] << 24) ? e() : (a(), t(2)));
				};
			});
			const o = "1.6.3".match(/(\d+)\.(\d+)\.(\d+)/), i = /* @__PURE__ */ new Uint8Array(5);
			return i[0] = 49, i[1] = parseInt(o[3]), i[2] = parseInt(o[2]), i[3] = parseInt(o[1]), i[4] = 0, r.send(i), r;
		}(e, t).then((e) => {
			n = e, a ? f() : n.close(), u(0);
		}, (e) => {
			a = null, o = 0, u(e);
		}), {
			get readyState() {
				return n ? n.readyState : 0;
			},
			send(e) {
				if (!a) return;
				const t = new Uint8Array(e);
				((e) => !(!n || n.readyState !== WebSocket.OPEN || 2 !== e[0] || (i && (clearTimeout(i), i = null), l(), n.send(e), 0)))(t) || (a.push(t), o += t.byteLength, a.length > 256 || o > 14680064 ? ((e) => {
					c || (c = !0, console.warn(`[ws-client] outbox overflow: ${e}`, {
						messages: a?.length ?? 0,
						bytes: o
					})), i && (clearTimeout(i), i = null), a = null, o = 0;
					try {
						n?.close(1009, "outbox overflow");
					} catch {}
					u(1);
				})("pending messages exceeded limits") : f());
			},
			close() {
				i && (clearTimeout(i), i = null), a = null, o = 0, n && n.close();
			}
		};
	}
	const n = (e, t) => {
		t ? console.error(`[ws-config] ${e}`, t) : console.error(`[ws-config] ${e}`);
	};
	const a = (e) => "number" == typeof e && Number.isFinite(e), o = (e) => "string" == typeof e, i = (e) => o(e) || a(e), s = [
		"init",
		"event",
		"packet",
		"packetBatch",
		"quiesce"
	];
	function c(e) {
		if (!function(e, t) {
			return null !== (r = e) && "object" == typeof r && 1 === e.v && o(e.type) && t.includes(e.type) && e.action === e.type;
			var r;
		}(e, s)) return !1;
		switch (e.action) {
			case "quiesce": return a(e.requestId);
			case "init": return e.files instanceof Map && (null === e.mpq || e.mpq instanceof File) && "boolean" == typeof e.spawn && "boolean" == typeof e.offscreen;
			case "event": return o(e.func) && Array.isArray(e.params) && e.params.every(i);
			case "packet": return (t = e.buffer) instanceof ArrayBuffer || t instanceof Uint8Array;
			case "packetBatch": return Array.isArray(e.batch) && e.batch.every((e) => e instanceof ArrayBuffer);
			default: return !1;
		}
		var t;
	}
	const u = (e) => /\.sv$/i.test(e), l = function() {
		const e = "wss://hellgate-ws.john-maks595.workers.dev/ws".trim(), r = globalThis.location?.protocol;
		let a;
		try {
			a = new URL(e);
		} catch (o) {
			const t = "VITE_WS_URL is not a valid URL";
			throw n(t, {
				value: e,
				error: o
			}), new Error(t, { cause: o });
		}
		if ("ws:" !== a.protocol && "wss:" !== a.protocol) {
			const t = "VITE_WS_URL must use ws:// or wss://";
			throw n(t, { value: e }), /* @__PURE__ */ new Error(t);
		}
		if ("https:" === r && "ws:" === a.protocol) {
			const t = "Insecure WebSocket URL (ws://) is not allowed on https pages";
			throw n(t, {
				value: e,
				protocol: r
			}), /* @__PURE__ */ new Error(t);
		}
		if ("ws:" === a.protocol) {
			const t = "Insecure WebSocket URL (ws://) is not allowed in production builds";
			throw n(t, {
				value: e,
				mode: "production"
			}), /* @__PURE__ */ new Error(t);
		}
		return a.toString();
	}(), f = self, p = (e) => ({
		...e,
		v: 1,
		type: e.action
	}), d = (e, t) => {
		t ? f.postMessage(e, t) : f.postMessage(e);
	};
	let h, w = null, y = null, b = null, _ = null, m = null, g = null, v = !1, A = null, S = !1;
	function D(e, t = "error") {
		e instanceof Error ? d(p({
			action: t,
			error: e.toString(),
			stack: e.stack
		})) : d(p({
			action: t,
			error: e?.toString?.() ?? String(e)
		}));
	}
	const x = {
		exit_error(e) {
			throw Error(e);
		},
		exit_game() {
			d(p({ action: "exit" }));
		},
		current_save_id(e) {
			d(p({
				action: "current_save",
				name: e >= 0 ? v ? `spawn${e}.sv` : `single_${e}.sv` : null
			}));
		},
		get_file_size(e) {
			const t = _?.get(e.toLowerCase());
			return t ? t.byteLength : 0;
		},
		get_file_contents(e, t, r) {
			const n = _?.get(e.toLowerCase());
			n && (n instanceof Uint8Array ? t.set(n.subarray(r, r + t.byteLength)) : n.readInto(t, r));
		},
		put_file_contents(e, t) {
			e = e.toLowerCase();
			const r = t.slice();
			_?.set(e, r), d(p({
				action: "fs",
				func: "update",
				params: [e, r]
			}));
		},
		remove_file(e) {
			e = e.toLowerCase(), _?.delete(e), d(p({
				action: "fs",
				func: "delete",
				params: [e]
			}));
		},
		set_cursor(e, t) {
			d(p({
				action: "cursor",
				x: e,
				y: t
			}));
		},
		open_keyboard(...e) {
			d(p({
				action: "keyboard",
				rect: [...e]
			}));
		},
		close_keyboard() {
			d(p({
				action: "keyboard",
				rect: null
			}));
		},
		use_websocket(e) {
			if (e) if (A && 1 === A.readyState) M("SNet_WebsocketStatus", 0);
			else {
				const e = A = r(l, (t) => {
					A === e && U(() => {
						const e = t, r = P._DApi_AllocPacket(e.byteLength);
						P.HEAPU8.set(new Uint8Array(e), r);
					});
				}, (e) => {
					if ("number" != typeof e) throw e;
					M("SNet_WebsocketStatus", e);
				});
			}
			else A && A.close(), A = null;
		},
		websocket_closed: () => !!A && 1 !== A.readyState
	}, k = {
		draw_begin() {
			m = {
				images: [],
				text: [],
				clip: null,
				belt: g
			}, g = null;
		},
		draw_blit(e, t, r, n, a) {
			m?.images.push({
				x: e,
				y: t,
				w: r,
				h: n,
				data: a.slice()
			});
		},
		draw_clip_text(e, t, r, n) {
			m.clip = {
				x0: e,
				y0: t,
				x1: r,
				y1: n
			};
		},
		draw_text(e, t, r, n) {
			m?.text.push({
				x: e,
				y: t,
				text: r,
				color: n
			});
		},
		draw_end() {
			const e = m?.images.map(({ data: e }) => e.buffer) ?? [];
			m?.belt && e.push(m.belt.buffer), d(p({
				action: "render",
				batch: m
			}), e), m = null;
		},
		draw_belt(e) {
			g = e.slice();
		}
	}, T = {
		draw_begin() {
			y && (y.save(), y.font = "bold 13px Times New Roman");
		},
		draw_blit(e, t, r, n, a) {
			y && b && (b.data.set(a), y.putImageData(b, e, t));
		},
		draw_clip_text(e, t, r, n) {
			y && (y.beginPath(), y.rect(e, t, r - e, n - t), y.clip());
		},
		draw_text(e, t, r, n) {
			if (y) {
				const a = n >> 16 & 255, o = n >> 8 & 255, i = 255 & n;
				y.fillStyle = `rgb(${a}, ${o}, ${i})`, y.fillText(r, e, t + 22);
			}
		},
		draw_end() {
			if (y && w) {
				y.restore();
				const e = w.transferToImageBitmap(), t = [e];
				g && t.push(g.buffer), d(p({
					action: "render",
					batch: {
						bitmap: e,
						belt: g
					}
				}), t), g = null;
			}
		},
		draw_belt(e) {
			g = e.slice();
		}
	};
	let E = null, C = null, I = 0, L = 0;
	[
		"create_sound_raw",
		"create_sound",
		"duplicate_sound"
	].forEach((e) => {
		x[e] = function(...t) {
			if (E) L = t[0] + 1, E.push({
				func: e,
				params: t
			}), "duplicate_sound" !== e && C.push(t[1].buffer);
			else {
				I = t[0] + 1;
				const r = [];
				"duplicate_sound" !== e && r.push(t[1].buffer), d(p({
					action: "audio",
					func: e,
					params: t
				}), r);
			}
		};
	}), [
		"play_sound",
		"set_volume",
		"stop_sound",
		"delete_sound"
	].forEach((e) => {
		x[e] = function(...t) {
			E && t[0] >= I ? E.push({
				func: e,
				params: t
			}) : d(p({
				action: "audio",
				func: e,
				params: t
			}));
		};
	});
	let R = null;
	x.websocket_send = function(e) {
		A ? A.send(e) : R ? R.push(e.slice().buffer) : d(p({
			action: "packet",
			buffer: e
		}));
	}, f.DApi = x;
	let P = null;
	function U(e) {
		if (!S) try {
			e();
		} catch (t) {
			D(t);
		}
	}
	function M(e, ...t) {
		U(() => {
			const r = null != E;
			if (r || (E = [], C = [], R = []), "text" !== e) P["_" + e](...t);
			else {
				const e = P._DApi_SyncTextPtr(), r = t[0], n = Math.min(r.length, 255), a = P.HEAPU8;
				for (let t = 0; t < n; ++t) a[e + t] = r.charCodeAt(t);
				a[e + n] = 0, P._DApi_SyncText(t[1]);
			}
			r || (E.length && (I = L, d(p({
				action: "audioBatch",
				batch: E
			}), C)), R.length && d(p({
				action: "packetBatch",
				batch: R
			}), R), E = null, C = null, R = null);
		});
	}
	const $ = (e, t, r) => {
		d(p({
			action: "progress",
			text: e,
			loaded: t,
			total: r
		}));
	}, W = (e, t) => function(e, t) {
		return new Promise((r, n) => {
			const a = new FileReader();
			a.onload = () => r(a.result), a.onerror = () => n(a.error), a.onabort = () => n(), t && a.addEventListener("progress", t), a.readAsArrayBuffer(e);
		});
	}(e, t).then((r) => (t?.({ loaded: e.size }), r));
	async function B(r, n) {
		const a = await async function(e, t, r) {
			const n = await fetch(e, r);
			if (!n.ok) throw new Error(`${n.status} ${n.statusText}`);
			const a = Number(n.headers.get("content-length") ?? 0), o = n.body?.getReader();
			if (!o) throw new Error("Response body is null");
			const i = [];
			let s = 0;
			for (;;) {
				const { done: e, value: r } = await o.read();
				if (e) break;
				r && (i.push(r), s += r.length, t?.(s, a));
			}
			const c = new Uint8Array(s);
			let u = 0;
			for (const l of i) c.set(l, u), u += l.length;
			return c.buffer;
		}(r ? (self.__DBASE+"assets/diabloSpawn-C9ivkBl9.wasm") : (self.__DBASE+"assets/diablo-BJaineoj.wasm"), (e, t) => n({
			loaded: e,
			total: t
		})), o = await async function(e, t) {
			const r = e(t);
			return r instanceof Promise ? r : r.ready;
		}(r ? t : e, { wasmBinary: a });
		return n({ loaded: 2e6 }), o;
	}
	async function N(e, t, r) {
		if (v = t, r ? (w = new OffscreenCanvas(640, 480), y = w.getContext("2d"), b = y.createImageData(640, 480), Object.assign(x, T)) : Object.assign(x, k), !e) {
			const e = t ? "spawn.mpq" : "diabdat.mpq";
			if (!_.has(e)) {
				const t = (self.__DBASE+"").endsWith("/") ? (self.__DBASE+"").slice(0, -1) : (self.__DBASE+"");
				_.set(e, await async function(e) {
					const t = await fetch(e);
					if (!t.ok) throw new Error(`Failed to load remote file: ${t.status}`);
					const r = [];
					let n = 0;
					const a = t.body?.getReader();
					try {
						if (Number(t.headers.get("Content-Length") || 0) > 1073741824) throw new Error("Remote file is too large");
						if (!a) throw new Error("Remote file response has no body");
						for (;;) {
							const { done: e, value: t } = await a.read();
							if (e) break;
							if (n + t.byteLength > 1073741824) throw new Error("Remote file is too large");
							t.byteLength && r.push({
								offset: n,
								bytes: t
							}), n += t.byteLength;
						}
					} catch (o) {
						throw a ? await a.cancel().catch(() => {}) : await t.body?.cancel().catch(() => {}), o;
					} finally {
						a?.releaseLock();
					}
					return {
						byteLength: n,
						readInto(e, t) {
							if (t < 0 || !Number.isSafeInteger(t)) throw new RangeError("Invalid archive offset");
							let a = 0, o = r.length;
							for (; a < o;) {
								const e = a + o >>> 1, n = r[e];
								n.offset + n.bytes.byteLength <= t ? a = e + 1 : o = e;
							}
							const i = Math.min(n, t + e.byteLength);
							for (let n = a; n < r.length && r[n].offset < i; n++) {
								const { offset: a, bytes: o } = r[n], s = Math.max(t, a), c = Math.min(i, a + o.byteLength);
								e.set(o.subarray(s - a, c - a), s - t);
							}
						}
					};
				}(`${t}/${e}`));
			}
		}
		$("Loading...");
		let n = 0;
		const a = e ? e.size : 0;
		let o = 0;
		const i = t ? 1215907 : 1364619;
		function s() {
			$("Loading...", n + 5 * o, a + 5 * i);
		}
		const c = B(t, (e) => {
			o = Math.min(e.loaded, i), s();
		}), u = e ? W(e, (e) => {
			const t = e;
			n = t.loaded ?? t.loadedBytes ?? n, s();
		}) : Promise.resolve(null), [l, f] = await Promise.all([c, u]);
		if (S) return;
		P = l, f && _.set(t ? "spawn.mpq" : "diabdat.mpq", new Uint8Array(f)), $("Initializing...");
		const p = "1.6.3".match(/(\d+)\.(\d+)\.(\d+)/);
		P._SNet_InitWebsocket(), P._DApi_Init(Math.floor(performance.now()), r ? 1 : 0, parseInt(p[1]), parseInt(p[2]), parseInt(p[3])), h = setInterval(() => {
			M("DApi_Render", Math.floor(performance.now()));
		}, 50);
	}
	f.addEventListener("message", ({ data: e }) => {
		if (c(e)) switch (e.action) {
			case "quiesce": {
				S = !0, clearInterval(h);
				const t = /* @__PURE__ */ new Map();
				for (const [e, r] of _ ?? []) u(e) && r instanceof Uint8Array && t.set(e, r.slice());
				d(p({
					action: "quiesced",
					requestId: e.requestId,
					saves: t
				}));
				break;
			}
			case "init":
				_ = e.files, N(e.mpq, e.spawn, e.offscreen).then(() => d(p({ action: "loaded" })), (e) => D(e, "failed"));
				break;
			case "event":
				M(e.func, ...e.params);
				break;
			case "packet":
				U(() => {
					const t = P._DApi_AllocPacket(e.buffer.byteLength);
					P.HEAPU8.set(new Uint8Array(e.buffer), t);
				});
				break;
			case "packetBatch": U(() => {
				for (const t of e.batch) {
					const e = P._DApi_AllocPacket(t.byteLength);
					P.HEAPU8.set(new Uint8Array(t), e);
				}
			});
		}
		else D(/* @__PURE__ */ new Error("Main thread protocol mismatch."));
	});
})();
