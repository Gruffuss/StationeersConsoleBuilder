-- Prints every ss.ui.icons table as sorted names, 15 entries per line. No sprites are read.
local icons = ss.ui.icons or {}
local kinds = {}
for kind, members in pairs(icons) do
  if type(members) == 'table' then kinds[#kinds + 1] = kind end
end
table.sort(kinds)
local lines = { 'ICONS kinds ' .. table.concat(kinds, ',') }
for _, kind in ipairs(kinds) do
  local rows = {}
  for key, value in pairs(icons[kind]) do rows[#rows + 1] = key .. '=' .. tostring(value) end
  table.sort(rows)
  lines[#lines + 1] = 'ICONS ' .. kind .. ' count ' .. #rows
  for first = 1, #rows, 15 do
    lines[#lines + 1] = 'ICONS ' .. kind .. ' ' .. table.concat(rows, ' | ', first, math.min(first + 14, #rows))
  end
end
local at = 0
function tick()
  at = at % #lines + 1
  print(lines[at])
end
