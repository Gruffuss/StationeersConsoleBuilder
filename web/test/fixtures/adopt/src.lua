local ui = ss.ui.surface('main')
assert(ui:size().w == 460 and ui:size().h == 460)
ss.ui.activate('main')
ui:element { id='scene', type='vector', rect={unit='px',x=10,y=20,w=200,h=100},
  props={scene='art',src='SCENE w=100 h=50\nR x=0 y=0 w=$value h=50 f=#fff id=next click=1'} }
local data = ui:element { id='data',type='vector',props={scene='art',data={value=10,enabled=true,list={1,2}}} }
ui:element { id='panel',type='panel',rect={x=0,y=0,w=1,h=1},style={bg='#222'} }
ui:element { id='label',type='label',rect={unit='px',x=5,y=6,w=70,h=30},props={text='Hello'} }
function tick(dt) data:set_props {data={value=20,enabled=true,list={1,2}}} end
