-- Prints every ic.enums table as "ENUM <table> <name> <value>" lines, 5 a tick, then "ENUM DONE <count>", and starts
-- over. A tick is 0.5 s, so a log that keeps its last 50 lines holds 5 s of rows: a save every few seconds misses none,
-- and a save missed is made up on a later pass. Pushed to the test chip the owner confirmed (plan W0b, question 20); its
-- log is read with get_chip_logs and saved to files until enums-collect.ts, which reads them together, accepts them.
-- Uses only the public ic.enums tables.
local rows = {}
for t, members in pairs(ic.enums) do
  if type(members) == 'table' then
    for name, v in pairs(members) do rows[#rows + 1] = 'ENUM ' .. tostring(t) .. ' ' .. tostring(name) .. ' ' .. tostring(v) end
  end
end
table.sort(rows)
local at = 0
function tick()
  for _ = 1, 5 do
    at = at + 1
    if at > #rows then
      print('ENUM DONE ' .. #rows)
      at = 0
      return
    end
    print(rows[at])
  end
end
