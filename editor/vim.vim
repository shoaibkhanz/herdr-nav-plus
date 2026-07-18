" herdr-nav-plus — Vim side (optional, for full vim -> space walks)
"
" Maps <C-h/j/k/l> to move between Vim splits. At a split edge, hand off to the
" herdr-nav-plus plugin so focus crosses into the neighbouring herdr pane and,
" on the vertical axis, keeps walking the workspace list (wrapping) at the pane edge.
"
" Load only ONE herdr navigation editor map. From your vimrc:
"   source /path/to/herdr-nav-plus/editor/vim.vim
"
" Only active inside a herdr pane (guards on $HERDR_PANE_ID).

if empty($HERDR_PANE_ID)
  finish
endif

function! s:Cross(dir) abort
  let l:herdr = empty($HERDR_BIN_PATH) ? 'herdr' : $HERDR_BIN_PATH
  " edge-* actions skip the Vim-forward step, so this never bounces back to Vim.
  call system(shellescape(l:herdr) . ' plugin action invoke edge-' . a:dir . ' --plugin herdr-nav-plus')
endfunction

function! s:Navigate(wincmd, dir) abort
  let l:prev = winnr()
  execute 'wincmd ' . a:wincmd
  if winnr() == l:prev
    call s:Cross(a:dir)
  endif
endfunction

nnoremap <silent> <C-h> :call <SID>Navigate('h', 'left')<CR>
nnoremap <silent> <C-j> :call <SID>Navigate('j', 'down')<CR>
nnoremap <silent> <C-k> :call <SID>Navigate('k', 'up')<CR>
nnoremap <silent> <C-l> :call <SID>Navigate('l', 'right')<CR>
