-- _extensions/quartostone/quartostone.lua
-- Quartostone Quarto Lua filter
--
-- Features:
--   1. Custom callout types  — ::: {.callout-todo} and ::: {.callout-question}
--   2. Backlink rendering   — reads 'quartostone-backlinks' YAML list
--   3. Page footer          — injects last-commit message + date via `git log`
--   4. Wiki links           — converts [[Page Name]] and [[Page|Display]] to real links
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

-- ── Wiki link filter ──────────────────────────────────────────────────────────
-- Converts [[Page Name]], [[Page Name|Display Text]], [[Page#anchor]] to
-- real Pandoc Link elements so that all output formats (HTML, PDF, DOCX…)
-- contain proper hyperlinks.

function Inlines(inlines)
  -- Quick scan: skip paragraphs that contain no '[['
  local has_wikilink = false
  for _, el in ipairs(inlines) do
    if el.t == 'Str' and el.text:find('%[%[', 1, true) then
      has_wikilink = true
      break
    end
  end
  if not has_wikilink then return nil end

  -- Flatten inlines to a plain-text string, preserving basic markdown
  local parts = {}
  for _, el in ipairs(inlines) do
    if     el.t == 'Str'      then parts[#parts + 1] = el.text
    elseif el.t == 'Space'    then parts[#parts + 1] = ' '
    elseif el.t == 'SoftBreak'then parts[#parts + 1] = ' '
    elseif el.t == 'Code'     then parts[#parts + 1] = '`' .. el.text .. '`'
    elseif el.t == 'Emph'     then
      parts[#parts + 1] = '*' .. pandoc.utils.stringify(el.content) .. '*'
    elseif el.t == 'Strong'   then
      parts[#parts + 1] = '**' .. pandoc.utils.stringify(el.content) .. '**'
    else
      parts[#parts + 1] = pandoc.utils.stringify(el)
    end
  end
  local text = table.concat(parts)

  -- Replace [[Target|Display Text]] → [Display Text](target.html)
  local modified = text:gsub('%[%[([^%]|]+)|([^%]]+)%]%]', function(target, display)
    local href = target:lower()
                       :gsub('%s+', '-')
                       :gsub('[^%a%d%-_/]', '')
                 .. '.html'
    return '[' .. display .. '](' .. href .. ')'
  end)

  -- Replace [[Target]] → [Target](target.html)
  modified = modified:gsub('%[%[([^%]]+)%]%]', function(target)
    -- Strip anchor portion for the href slug, but keep full target as display
    local slug_part = target:match('^([^#]+)') or target
    local href = slug_part:lower()
                           :gsub('%s+', '-')
                           :gsub('[^%a%d%-_/]', '')
                 .. '.html'
    return '[' .. target .. '](' .. href .. ')'
  end)

  -- If nothing changed, leave document alone
  if modified == text then return nil end

  -- Parse the modified markdown back to proper Pandoc inlines
  local doc = pandoc.read(modified, 'markdown')
  if doc.blocks[1] and doc.blocks[1].t == 'Para' then
    return doc.blocks[1].content
  end
  return nil
end
