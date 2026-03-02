-- _extensions/quartostone/quartostone.lua
-- Quartostone Quarto Lua filter
--
-- Features:
--   1. Custom callout types  — ::: {.callout-todo} and ::: {.callout-question}
--   2. Backlink rendering   — reads 'quartostone-backlinks' YAML list
--   3. Page footer          — injects last-commit message + date via `git log`
--
-- Disable footer per-page with: quartostone-footer: false

-- ── Git helper ───────────────────────────────────────────────────────────────

local function git_last_commit(filepath)
  local cmd
  if filepath and filepath ~= '' then
    cmd = 'git log -1 --format="%s|||%ad" --date=format:"%B %d, %Y" -- "'
          .. filepath .. '" 2>/dev/null'
  else
    cmd = 'git log -1 --format="%s|||%ad" --date=format:"%B %d, %Y" 2>/dev/null'
  end

  local ok, handle = pcall(io.popen, cmd)
  if not ok or not handle then return nil, nil end
  local result = handle:read('*a')
  handle:close()
  if not result or result:gsub('%s', '') == '' then return nil, nil end

  result = result:gsub('%s+$', '')
  local sep = result:find('|||', 1, true)
  if not sep then return result, nil end
  return result:sub(1, sep - 1), result:sub(sep + 3)
end

-- ── Custom callout Div filter ────────────────────────────────────────────────

function Div(el)
  local CUSTOM = { ['callout-todo'] = '☑', ['callout-question'] = '❓' }
  for cls, icon in pairs(CUSTOM) do
    if el.classes:includes(cls) then
      local ctype      = cls:gsub('callout%-', '')
      local label      = ctype:sub(1, 1):upper() .. ctype:sub(2)
      local user_title = el.attributes['title']
      local title_str  = user_title and user_title or label

      local header = pandoc.Div(
        { pandoc.Plain({
            pandoc.RawInline('html',
              '<strong class="callout-title-text">'
              .. icon .. '&nbsp;' .. title_str .. '</strong>')
          }) },
        pandoc.Attr('', { 'callout-header' })
      )
      local body = pandoc.Div(el.content, pandoc.Attr('', { 'callout-body' }))
      return pandoc.Div(
        { header, body },
        pandoc.Attr('', { 'callout', 'qs-callout-' .. ctype })
      )
    end
  end
end

-- ── Document filter (backlinks + footer) ─────────────────────────────────────

function Pandoc(doc)
  local blocks = doc.blocks
  local meta   = doc.meta

  -- 1. Backlinks  ────────────────────────────────────────────────────────────
  --    YAML: quartostone-backlinks:
  --            - { title: "Page A", path: "../pageA.html" }
  local backlinks = meta['quartostone-backlinks']
  if type(backlinks) == 'table' and #backlinks > 0 then
    local items = {}
    for _, bl in ipairs(backlinks) do
      local title = pandoc.utils.stringify(bl['title'] or pandoc.Str('Untitled'))
      local path  = pandoc.utils.stringify(bl['path']  or pandoc.Str('#'))
      items[#items + 1] = {
        pandoc.Plain({ pandoc.Link({ pandoc.Str(title) }, path) })
      }
    end
    if #items > 0 then
      blocks[#blocks + 1] = pandoc.HorizontalRule()
      blocks[#blocks + 1] = pandoc.Header(2, { pandoc.Str('Backlinks') })
      blocks[#blocks + 1] = pandoc.BulletList(items)
    end
  end

  -- 2. Page footer  ──────────────────────────────────────────────────────────
  --    Disable per-page: quartostone-footer: false
  local show_footer = meta['quartostone-footer']
  if show_footer == nil or pandoc.utils.stringify(show_footer) ~= 'false' then
    local filepath = PANDOC_STATE and PANDOC_STATE.input_files
                     and PANDOC_STATE.input_files[1] or ''
    local msg, date = git_last_commit(filepath)
    if msg and date then
      local html = string.format(
        '<footer class="qs-page-footer">'
        .. '<span class="qs-footer-commit">%s</span>'
        .. '<span class="qs-footer-sep"> · </span>'
        .. '<span class="qs-footer-date">%s</span>'
        .. '</footer>',
        msg, date
      )
      blocks[#blocks + 1] = pandoc.RawBlock('html', html)
    end
  end

  return pandoc.Pandoc(blocks, meta)
end
