<script>
  import { onMount, onDestroy } from 'svelte';

  // Props
  export let profile = '';
  import { _ } from 'svelte-i18n';

  let terminalEl;
  let term        = null;
  let fitAddon    = null;
  let ws          = null;
  let status      = 'disconnected'; // disconnected | connecting | connected | error
  let errorMsg    = '';
  let resizeObs   = null;

  onMount(async () => {
    const { Terminal }  = await import('@xterm/xterm');
    const { FitAddon }  = await import('@xterm/addon-fit');

    term = new Terminal({
      theme: {
        background:  '#030712',  // gray-950
        foreground:  '#d1d5db',  // gray-300
        cursor:      '#6366f1',  // indigo-500
        black:       '#111827',
        brightBlack: '#374151',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      fontSize:   14,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 2000,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);
    fitAddon.fit();

    resizeObs = new ResizeObserver(() => { if (fitAddon) fitAddon.fit(); });
    resizeObs.observe(terminalEl);

    connect();
  });

  onDestroy(() => {
    resizeObs?.disconnect();
    closeWs();
    term?.dispose();
  });

  function connect() {
    closeWs();
    status   = 'connecting';
    errorMsg = '';

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'terminal_open',
        profile,
        cols: term?.cols || 80,
        rows: term?.rows || 24,
      }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'terminal_connecting':
          status = 'connecting';
          break;

        case 'terminal_ready':
          status = 'connected';
          // Forward keyboard input to server
          term.onData((data) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'terminal_input', data }));
            }
          });
          // Forward resize events to server
          term.onResize(({ cols, rows }) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'terminal_resize', cols, rows }));
            }
          });
          break;

        case 'terminal_data':
          // data is base64-encoded binary from the PTY
          term?.write(Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)));
          break;

        case 'terminal_closed':
          status = 'disconnected';
          term?.writeln('\r\n\x1b[2m[Session closed]\x1b[0m');
          closeWs();
          break;

        case 'terminal_error':
          status   = 'error';
          errorMsg = msg.message;
          term?.writeln(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m`);
          closeWs();
          break;

        default:
          break;
      }
    };

    ws.onclose = () => {
      if (status === 'connected') {
        status = 'disconnected';
        term?.writeln('\r\n\x1b[2m[Disconnected]\x1b[0m');
      }
    };

    ws.onerror = () => {
      status   = 'error';
      errorMsg = 'WebSocket connection failed';
    };
  }

  function closeWs() {
    if (ws) { try { ws.close(); } catch {} ws = null; }
  }

  function reconnect() {
    term?.clear();
    connect();
  }
</script>

<!-- xterm CSS loaded via app.css import -->

<div class="flex flex-col h-full">

  <!-- Status bar -->
  <div class="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 rounded-t-lg">
    <div class="flex items-center gap-2 text-xs">
      <span class="w-2 h-2 rounded-full shrink-0
             {status === 'connected'    ? 'bg-green-400' :
              status === 'connecting'   ? 'bg-amber-400 animate-pulse' :
              status === 'error'        ? 'bg-red-400' :
                                          'bg-gray-600'}"></span>
      <span class="text-gray-400">
        {#if status === 'connected'}{$_('terminal.connected', { values: { profile } })}
        {:else if status === 'connecting'}{$_('terminal.connecting')}
        {:else if status === 'error'}Error: {errorMsg}
        {:else}{$_('terminal.disconnected')}
        {/if}
      </span>
    </div>

    <button
      type="button"
      onclick={reconnect}
      class="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-0.5 rounded
             hover:bg-gray-800"
    >
      {$_('terminal.reconnect')}
    </button>
  </div>

  <!-- Terminal canvas -->
  <div
    bind:this={terminalEl}
    class="flex-1 rounded-b-lg overflow-hidden"
    style="min-height: 380px; background: #030712;"
  ></div>

</div>
