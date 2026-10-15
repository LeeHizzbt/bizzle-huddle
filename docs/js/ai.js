/* Bizzle Huddle v4.20 — AI provider adapter (Gemini, Groq, OpenRouter).
   Keys are read from this device's localStorage only. Never sent to Supabase. */
(function () {
  'use strict';
  var PROVIDERS = {
    gemini: {
      label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', vision: true,
      tiers: { Fast: 'gemini-flash-lite-latest', Pro: 'gemini-flash-latest', Max: 'gemini-pro-latest' },
      fallback: { 'gemini-pro-latest': 'gemini-flash-latest', 'gemini-flash-latest': 'gemini-flash-lite-latest' },
      models: ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-pro-latest', 'gemma-4-31b-it']
    },
    groq: {
      label: 'Groq', keyUrl: 'https://console.groq.com/keys', vision: true,
      tiers: { Fast: 'openai/gpt-oss-20b', Pro: 'qwen/qwen3.8-27b', Max: 'openai/gpt-oss-120b' },
      fallback: { 'openai/gpt-oss-120b': 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b': 'openai/gpt-oss-20b' },
      visionModels: ['qwen/qwen3.8-27b'],
      models: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b']
    },
    openrouter: {
      label: 'OpenRouter (free models)', keyUrl: 'https://openrouter.ai/keys', vision: true,
      tiers: { Fast: 'openrouter/free', Pro: 'google/gemma-4-31b-it:free', Max: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
      fallback: { 'nvidia/nemotron-3-ultra-550b-a55b:free': 'openrouter/free', 'google/gemma-4-31b-it:free': 'openrouter/free' },
      models: ['openrouter/free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free']
    }
  };
  var TIER_INFO = {
    Fast: 'Quick replies, lowest quota use (≈1/10 of Max).',
    Pro: 'Balanced everyday work (≈1/2 of Max).',
    Max: 'Hardest tasks, biggest model. Falls back to Pro automatically if the free quota is out.'
  };

  var LS_KEYS = 'bh.aiKeys', LS_SET = 'bh.aiSettings';
  function getKeys() { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); } catch (e) { return {}; } }
  function setKeys(k) { localStorage.setItem(LS_KEYS, JSON.stringify(k || {})); }
  function defaults() {
    return { provider: 'gemini', model: '', temperature: 0.7, maxTokens: 1024, systemPrompt: '', theme: 'neon' };
  }
  function getSettings() {
    var d = defaults();
    try { var s = JSON.parse(localStorage.getItem(LS_SET) || '{}'); for (var k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function setSettings(s) { localStorage.setItem(LS_SET, JSON.stringify(s)); }

  function modelFor(provider, effort, explicit) {
    if (explicit) return explicit;
    var p = PROVIDERS[provider] || PROVIDERS.gemini;
    return p.tiers[effort || 'Pro'];
  }
  function estTokens(s) { return Math.ceil((s || '').length / 4); }

  function AIError(msg, status, provider, model) {
    var e = new Error(msg); e.status = status; e.provider = provider; e.model = model; return e;
  }

  /* Build the provider request. Exposed for tests (request formation without keys). */
  function buildRequest(opts) {
    var provider = opts.provider, model = opts.model, key = opts.key || '';
    var msgs = opts.messages || []; var sys = opts.system || '';
    var temperature = opts.temperature == null ? 0.7 : Number(opts.temperature);
    var maxTokens = opts.maxTokens || 1024;
    if (provider === 'gemini') {
      var contents = msgs.map(function (m) {
        var parts = [];
        if (m.text) parts.push({ text: m.text });
        (m.images || []).forEach(function (img) { parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } }); });
        if (!parts.length) parts.push({ text: '(empty)' });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts };
      });
      // Gemini requires alternating roles: merge consecutive same-role turns
      var merged = [];
      contents.forEach(function (c) {
        var last = merged[merged.length - 1];
        if (last && last.role === c.role) last.parts = last.parts.concat(c.parts); else merged.push(c);
      });
      if (merged.length && merged[0].role === 'model') merged.unshift({ role: 'user', parts: [{ text: '(conversation start)' }] });
      var body = { contents: merged, generationConfig: { temperature: temperature, maxOutputTokens: maxTokens } };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }
      };
    }
    var url = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    var vision = provider !== 'groq' || (PROVIDERS.groq.visionModels.indexOf(model) >= 0);
    var out = [];
    if (sys) out.push({ role: 'system', content: sys });
    msgs.forEach(function (m) {
      var imgs = vision ? (m.images || []) : [];
      if (imgs.length && m.role !== 'assistant') {
        var content = [{ type: 'text', text: m.text || 'See image.' }];
        imgs.forEach(function (img) { content.push({ type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.base64 } }); });
        out.push({ role: 'user', content: content });
      } else {
        var t = m.text || '';
        if ((m.images || []).length && !vision) t += '\n[An image was attached but this model has no vision.]';
        out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: t || '(empty)' });
      }
    });
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
    if (provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Bizzle Huddle v4.20'; }
    var b = { model: model, messages: out, temperature: temperature, max_tokens: maxTokens };
    if (provider === 'groq' && /gpt-oss/.test(model)) b.reasoning_effort = opts.effort === 'Max' ? 'high' : (opts.effort === 'Fast' ? 'low' : 'medium');
    return { url: url, init: { method: 'POST', headers: headers, body: JSON.stringify(b) } };
  }

  function parseResponse(provider, data) {
    if (provider === 'gemini') {
      var c = (data.candidates || [])[0];
      var text = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      if (!text && c && c.finishReason) text = '[No text returned: ' + c.finishReason + ']';
      var u = data.usageMetadata || {};
      return { text: text, promptTokens: u.promptTokenCount || 0, completionTokens: u.candidatesTokenCount || 0, model: data.modelVersion };
    }
    var ch = (data.choices || [])[0];
    var t = ch && ch.message ? (typeof ch.message.content === 'string' ? ch.message.content : (ch.message.content || []).map(function (p) { return p.text || ''; }).join('')) : '';
    var us = data.usage || {};
    return { text: t || '', promptTokens: us.prompt_tokens || 0, completionTokens: us.completion_tokens || 0, model: data.model };
  }

  function friendlyError(status, provider, raw) {
    var msg = '';
    try { var j = JSON.parse(raw); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { msg = (raw || '').slice(0, 200); }
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    var hint = '';
    if (status === 400 && /api key|API_KEY/i.test(msg)) hint = 'Your ' + PROVIDERS[provider].label + ' key looks invalid.';
    else if (status === 401 || status === 403) hint = 'The ' + PROVIDERS[provider].label + ' key was rejected (401/403). Check it in Advanced AI Settings.';
    else if (status === 404) hint = 'That model is not available for this key. Pick another in the model picker.';
    else if (status === 429) hint = 'Free quota / rate limit hit (429). Wait a minute or switch to a Fast tier model.';
    else if (status >= 500) hint = 'The provider is overloaded (' + status + '). Try again shortly.';
    return (hint ? hint + ' ' : '') + (msg ? '— ' + msg.slice(0, 240) : '');
  }

  /* Main call. opts: {provider, model, effort, messages:[{role,text,images}], system, temperature, maxTokens, signal}
     Returns {text, promptTokens, completionTokens, estimated, model, provider} */
  function chat(opts) {
    var keys = getKeys();
    var provider = opts.provider || 'gemini';
    var key = opts.key || keys[provider];
    var model = opts.model || modelFor(provider, opts.effort);
    if (!key) return Promise.reject(AIError('No ' + (PROVIDERS[provider] || {}).label + ' key on this device. Open ⚙️ Advanced AI Settings and paste your free key.', 0, provider, model));
    var tries = 0, retried = {};
    function attempt(m) {
      tries++;
      var req = buildRequest({ provider: provider, model: m, key: key, messages: opts.messages, system: opts.system,
        temperature: opts.temperature, maxTokens: opts.maxTokens, effort: opts.effort });
      if (opts.signal) req.init.signal = opts.signal;
      return fetch(req.url, req.init).then(function (r) {
        return r.text().then(function (raw) {
          if (!r.ok) {
            var fb = (PROVIDERS[provider].fallback || {})[m];
            if ((r.status === 429 || r.status === 503 || r.status === 404) && fb && tries < 4) return attempt(fb);
            // transient overload on the last model in the chain: one short retry of the same model
            if ((r.status === 503 || r.status === 500) && !fb && !retried[m]) { retried[m] = true; return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return attempt(m); }); }
            throw AIError(friendlyError(r.status, provider, raw), r.status, provider, m);
          }
          var data; try { data = JSON.parse(raw); } catch (e) { throw AIError('Provider returned non-JSON.', r.status, provider, m); }
          var out = parseResponse(provider, data);
          var estimated = false;
          if (!out.promptTokens && !out.completionTokens) {
            estimated = true;
            out.promptTokens = estTokens((opts.system || '') + (opts.messages || []).map(function (x) { return x.text || ''; }).join(' '));
            out.completionTokens = estTokens(out.text);
          }
          out.estimated = estimated; out.provider = provider; out.model = out.model || m; out.requestedModel = m;
          return out;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') throw err;
        throw AIError('Network error calling ' + PROVIDERS[provider].label + ' (offline or blocked by CORS). ' + (err && err.message || ''), 0, provider, m);
      });
    }
    return attempt(model);
  }

  /* Live model list for the picker. OpenRouter list is public; Gemini/Groq need the key. */
  function listModels(provider, opts) {
    opts = opts || {};
    var key = getKeys()[provider];
    var P = PROVIDERS[provider];
    if (provider === 'openrouter') {
      return fetch('https://openrouter.ai/api/v1/models').then(function (r) { return r.json(); }).then(function (d) {
        return (d.data || []).filter(function (m) {
          return opts.paid || /:free$/.test(m.id) || m.id === 'openrouter/free' || (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0');
        }).map(function (m) { return { id: m.id, vision: (m.architecture && (m.architecture.input_modalities || []).indexOf('image') >= 0) }; });
      });
    }
    if (!key) return Promise.resolve(P.models.map(function (id) { return { id: id }; }));
    if (provider === 'gemini') {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })
        .then(function (r) { return r.json(); }).then(function (d) {
          return (d.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && !/tts|image|lyria|robotics|computer-use|transcribe|banana/.test(m.name); })
            .map(function (m) { return { id: m.name.replace(/^models\//, ''), vision: true }; });
        });
    }
    return fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } })
      .then(function (r) { return r.json(); }).then(function (d) {
        return (d.data || []).filter(function (m) { return m.active !== false && !/whisper|guard|tts|orpheus/.test(m.id); })
          .map(function (m) { return { id: m.id, vision: P.visionModels.indexOf(m.id) >= 0 }; });
      });
  }

  window.HuddleAI = {
    PROVIDERS: PROVIDERS, TIER_INFO: TIER_INFO, getKeys: getKeys, setKeys: setKeys, getSettings: getSettings,
    setSettings: setSettings, modelFor: modelFor, buildRequest: buildRequest, parseResponse: parseResponse,
    friendlyError: friendlyError, chat: chat, listModels: listModels, estTokens: estTokens
  };
})();
