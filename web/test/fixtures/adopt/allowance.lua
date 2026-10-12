local ui = ss.ui.surface('main')
local n = 0
local function src() return 'SCENE w=100 h=100\nR x='..n..' y=0 w=10 h=10 f=#fff id=next click=1' end
local e = ui:element {id='scene',type='vector',rect={x=0,y=0,w=1,h=1},props={src=src()}}
e:on('click',function() n=n+1 e:set_props {src=src()} end)
