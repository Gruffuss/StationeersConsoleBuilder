local ui = ss.ui.surface('main')
local a = 'SCENE w=100 h=100\nR x=0 y=0 w=40 h=40 f=#fff id=next click=1\nR x=50 y=0 w=40 h=40 f=#fff id=more click=1'
local b = 'SCENE w=100 h=100\nR x=0 y=0 w=100 h=100 f=#f00 id=back click=1'
local e = ui:element {id='scene',type='vector',rect={x=0,y=0,w=1,h=1},props={src=a}}
e:on('click',function(id)
  if id=='next' then e:set_props {src=b}
  elseif id=='back' then e:set_props {src=a}
  elseif id=='more' then
    local other = ss.ui.surface('second')
    other:element {id='scene',type='vector',rect={x=0,y=0,w=1,h=1},props={src='SCENE w=100 h=100\nR x=0 y=0 w=100 h=100 f=#0f0'}}
    ss.ui.activate('second')
  end
end)
