(function() {
	async function t(t = {}) {
		var e = t, r = !!globalThis.window, n = !!globalThis.WorkerGlobalScope;
		globalThis.process?.versions?.node && globalThis.process;
		var o, i = (t, e) => {
			throw e;
		}, s = (self.__DBASE+"assets/w.js"), a = "";
		if (r || n) {
			try {
				a = new URL(".", s).href;
			} catch {}
			n && (o = (t) => {
				var e = new XMLHttpRequest();
				return e.open("GET", t, !1), e.responseType = "arraybuffer", e.send(null), new Uint8Array(e.response);
			});
		}
		console.log.bind(console);
		var u, c, f = console.error.bind(console), l = !1;
		class p {}
		class h extends p {
			constructor(t) {
				super(), this.excPtr = t;
			}
		}
		const d = 34821223, m = 2310721022;
		function w(t) {
			return "0x" + (t >>> 0).toString(16).padStart(8, "0");
		}
		function y() {
			if (!l) {
				var t = K();
				0 == t && (t += 4);
				var e, r = v[t >> 2], n = v[t + 4 >> 2];
				r == d && n == m || S(`Stack overflow! Stack cookie has been overwritten at ${e = t, "0x" + (e >>>= 0).toString(16).padStart(8, "0")}, expected hex dwords ${w(m)} and ${w(d)}, but received ${w(n)} ${w(r)}`), 1668509029 != v[0] && S("Runtime error: The application has corrupted its heap memory area (address zero)!");
			}
		}
		var g, b, v, _ = !1;
		function A() {
			if (!b?.buffer?.resizable) {
				var t = Y.buffer;
				b = new Int8Array(t), e.HEAPU8 = R = new Uint8Array(t), new Int32Array(t), e.HEAPU32 = v = new Uint32Array(t);
			}
		}
		function S(t) {
			throw e.onAbort?.(t), f(t = `Aborted(${t})`), l = !0, t += ". Build with -sASSERTIONS for more info.", new WebAssembly.RuntimeError(t);
		}
		function x() {
			return e.locateFile ? a + "MpqCmp.wasm" : (self.__DBASE+"assets/MpqCmp.wasm");
		}
		function E(t, e) {
			var r, n = function(t) {
				if (t == g && u) return new Uint8Array(u);
				if (o) return o(t);
				throw "sync fetching of the wasm failed: you can preload it to Module[\"wasmBinary\"] manually, or emcc.py will do that for you when generating HTML (but not JS)";
			}(t);
			return r = new WebAssembly.Module(n), [new WebAssembly.Instance(r, e), r];
		}
		class T {
			name = "ExitStatus";
			constructor(t) {
				this.message = `Program terminated with exit(${t})`, this.status = t;
			}
		}
		var C = (t) => {
			for (; t.length > 0;) t.shift()(e);
		}, k = [], M = [], P = !0;
		var R, U = globalThis.TextDecoder && new TextDecoder(), D = (t, e, r) => t ? ((t, e = 0, r, n) => {
			var o = ((t, e, r, n) => {
				var o = e + r;
				if (n) return o;
				for (; t[e] && !(e >= o);) ++e;
				return e;
			})(t, e, r, n);
			if (o - e > 16 && t.buffer && U) return U.decode(t.subarray(e, o));
			for (var i = ""; e < o;) {
				var s = t[e++];
				if (128 & s) {
					var a = 63 & t[e++];
					if (192 != (224 & s)) {
						var u = 63 & t[e++];
						if ((s = 224 == (240 & s) ? (15 & s) << 12 | a << 6 | u : (7 & s) << 18 | a << 12 | u << 6 | 63 & t[e++]) < 65536) i += String.fromCharCode(s);
						else {
							var c = s - 65536;
							i += String.fromCharCode(55296 | c >> 10, 56320 | 1023 & c);
						}
					} else i += String.fromCharCode((31 & s) << 6 | a);
				} else i += String.fromCharCode(s);
			}
			return i;
		})(R, t, e, r) : "", I = null;
		class L {
			constructor(t) {
				this.excPtr = t, this.ptr = t - 24;
			}
			set_type(t) {
				v[this.ptr + 4 >> 2] = t;
			}
			get_type() {
				return v[this.ptr + 4 >> 2];
			}
			set_destructor(t) {
				v[this.ptr + 8 >> 2] = t;
			}
			get_destructor() {
				return v[this.ptr + 8 >> 2];
			}
			set_caught(t) {
				t = t ? 1 : 0, b[this.ptr + 12] = t;
			}
			get_caught() {
				return 0 != b[this.ptr + 12];
			}
			set_rethrown(t) {
				t = t ? 1 : 0, b[this.ptr + 13] = t;
			}
			get_rethrown() {
				return 0 != b[this.ptr + 13];
			}
			init(t, e) {
				this.set_adjusted_ptr(0), this.set_type(t), this.set_destructor(e);
			}
			set_adjusted_ptr(t) {
				v[this.ptr + 16 >> 2] = t;
			}
			get_adjusted_ptr() {
				return v[this.ptr + 16 >> 2];
			}
		}
		var $ = 0, z = {}, H = (t) => {
			if (t instanceof T || "unwind" == t) return c;
			y(), t instanceof WebAssembly.RuntimeError && N() <= 0 && f("Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)"), i(0, t);
		}, q = () => P || $ > 0, B = (t) => {
			c = t, q() || (l = !0), i(0, new T(t));
		}, W = (t, e) => {
			c = t, B(t);
		}, j = (t) => {
			if (!l) try {
				return t();
			} catch (e) {
				H(e);
			} finally {
				(() => {
					if (!q()) try {
						W(c);
					} catch (e) {
						H(e);
					}
				})();
			}
		}, G = (t, e) => Math.ceil(t / e) * e, O = (t) => {
			var e = (t - Y.buffer.byteLength + 65535) / 65536 | 0;
			try {
				return Y.grow(e), A(), 1;
			} catch (r) {}
		};
		e.noExitRuntime && (P = e.noExitRuntime), e.print && e.print, e.printErr && (f = e.printErr), e.wasmBinary && (u = e.wasmBinary), e.arguments && e.arguments, e.thisProgram && e.thisProgram;
		var F, J, K, N, X, Y, Z = e.preInit;
		if (Z) for ("function" == typeof Z && (e.preInit = Z = [Z]); Z.length > 0;) Z.shift()();
		var Q = {
			l: (t, e, r, n) => S(`Assertion failed: ${D(t)}, at: ` + [
				e ? D(e) : "unknown filename",
				r,
				n ? D(n) : "unknown function"
			]),
			b: (t, e, r) => {
				throw new L(t).init(e, r), X(t), I = new h(t), I;
			},
			e: () => S(""),
			d: () => {
				P = !1, $ = 0;
			},
			j: (t, e) => (z[t] && (clearTimeout(z[t].id), delete z[t]), e ? (z[t] = {
				id: setTimeout(() => {
					delete z[t], j(() => F(t, performance.now()));
				}, e),
				timeout_ms: e
			}, 0) : 0),
			a: function(t) {
				var e = R.indexOf(0, t), r = String.fromCharCode.apply(null, R.subarray(t, e));
				self.DApi.exit_error(r);
			},
			f: function(t, e) {
				self.DApi.progress(t, e);
			},
			k: (t) => {
				var e = R.length, r = 2147483648;
				if ((t >>>= 0) > r) return !1;
				for (var n = 1; n <= 4; n *= 2) {
					var o = e * (1 + .2 / n);
					if (o = Math.min(o, t + 100663296), O(Math.min(r, G(Math.max(t, o), 65536)))) return !0;
				}
				return !1;
			},
			i: function(t, e, r) {
				self.DApi.get_file_contents(R.subarray(t, t + r), e);
			},
			c: B,
			g: function(t, e, r) {
				self.DApi.put_file_contents(R.subarray(t, t + r), e);
			},
			h: function(t) {
				self.DApi.put_file_size(t);
			}
		};
		function V() {
			var t;
			J(), 0 == (t = K()) && (t += 4), v[t >> 2] = d, v[t + 4 >> 2] = m, v[0] = 1668509029;
		}
		var tt, et, rt = (et = { a: Q }, g ??= x(), tt = E(g, et)[0], function(t) {
			e._DApi_Alloc = t.o, e._DApi_Compress = t.p, F = t.q, t.s, J = t.t, K = t.u, t.v, N = t.w, X = t.x, t.y, t.z, Y = t.m, t.r;
		}(rt = tt.exports), A(), rt);
		return await async function() {
			V(), function() {
				var t = e.preRun;
				t && ("function" == typeof t && (t = [t]), M.push(...t)), C(M);
			}();
			var t = e.setStatus;
			t && (t("Running..."), await new Promise((t) => setTimeout(t, 1)), setTimeout(t, 1, "")), l || (_ = !0, y(), rt.n(), y(), e.onRuntimeInitialized?.(), function() {
				y();
				var t = e.postRun;
				t && ("function" == typeof t && (t = [t]), k.push(...t)), C(k);
			}());
		}(), e.ready = new Promise(function(t, r) {
			delete e.then, e.onAbort = function(t) {
				r(t);
			};
			const n = function() {
				t(e);
			};
			var o;
			_ ? n() : (o = n, k.push(o));
		}), e;
	}
	const e = self;
	let r = null, n = 0, o = null, i = 0;
	async function s({ binary: i, mpq: s, input: a, offset: u, blockSize: c }) {
		if (!i || !s || !a || void 0 === u || void 0 === c) throw new Error("Invalid arguments passed to the worker");
		const f = await async function(t, e) {
			const r = t(e);
			return r instanceof Promise ? r : r.ready;
		}(t, { wasmBinary: i });
		r = new Uint8Array(s), n = u;
		const l = a.length / 6, p = f._DApi_Alloc(a.byteLength);
		f.HEAPU32.set(a, p >> 2);
		const h = f._DApi_Compress(u + r.length, c, l, p) >> 2;
		e.postMessage({
			action: "result",
			buffer: o.buffer,
			blocks: f.HEAPU32.slice(h, h + 4 * l)
		}, [o.buffer, f.HEAPU32.slice(h, h + 4 * l).buffer]);
	}
	e.DApi = {
		exit_error(t) {
			throw Error(t);
		},
		get_file_contents(t, e) {
			if (r) {
				const o = e - n;
				t.set(r.subarray(o, o + t.byteLength));
			}
		},
		put_file_size(t) {
			o = new Uint8Array(t);
		},
		put_file_contents(t, e) {
			o && o.set(t, e);
		},
		progress(t, r) {
			const n = performance.now();
			var o;
			(t === r || n > i + 100) && (o = t, e.postMessage({
				action: "progress",
				value: o
			}), i = n);
		}
	}, e.addEventListener("message", ({ data: t }) => {
		"run" === t.action && s(t).catch((t) => e.postMessage({
			action: "error",
			error: t.toString(),
			stack: t.stack
		}));
	});
})();
