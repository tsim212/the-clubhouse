from playwright.sync_api import sync_playwright
B='http://localhost:4100';S='screens/'
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx=br.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
    pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
    pg.goto(B);pg.wait_for_selector('.team-choice');pg.screenshot(path=S+'01-team-picker.png',full_page=True)
    pg.click('.team-choice[data-id="14"]');pg.wait_for_selector('.pin-boxes input');pg.screenshot(path=S+'02-pin-create.png')
    for d in '4821':pg.keyboard.type(d)
    pg.click('#go');pg.wait_for_selector('.score',timeout=30000);pg.screenshot(path=S+'03-coach.png',full_page=True);print('claim+coach OK')
    for t,n in [('waivers','04-waivers'),('lineup','05-lineup'),('news','07-news'),('league','08-league')]:
        pg.click(f'.tabs [data-t="{t}"]');pg.wait_for_timeout(1500);pg.screenshot(path=S+n+'.png',full_page=True)
    pg.click('#hm [data-m="year"]');pg.wait_for_timeout(300);pg.screenshot(path=S+'09-history-by-season.png',full_page=True)
    pg.click('.tabs [data-t="notes"]');pg.fill('#nt','Started Taylor test note');pg.click('#save');pg.wait_for_timeout(800)
    assert 'Taylor test note' in pg.content();pg.screenshot(path=S+'06-notes.png',full_page=True);print('notes OK')
    # wrong PIN on another device
    c2=br.new_context(viewport={'width':390,'height':844},device_scale_factor=2);p2=c2.new_page()
    p2.goto(B);p2.click('.team-choice[data-id="14"]');p2.wait_for_selector('.pin-boxes input');p2.keyboard.type('0000');p2.wait_for_timeout(1000)
    assert 'did not work' in p2.inner_text('#err');p2.screenshot(path=S+'10-wrong-pin.png');print('wrong pin rejected OK')
    p2.fill('.pin-boxes input >> nth=0','')
    for i,d in enumerate('4821'):p2.fill(f'.pin-boxes input >> nth={i}',d)
    p2.wait_for_selector('.score',timeout=30000);print('login OK')
    # admin
    a=br.new_context(viewport={'width':390,'height':844},device_scale_factor=2).new_page();a.on('dialog',lambda d:d.accept())
    a.goto(B+'/admin');a.fill('#pw','nope');a.click('#go');a.wait_for_timeout(1200);assert 'Wrong' in a.inner_text('#e')
    a.fill('#pw','testadmin');a.click('#go');a.wait_for_selector('[data-id="14"]');a.screenshot(path=S+'11-admin.png',full_page=True)
    a.click('[data-id="14"]');a.wait_for_timeout(1000);assert a.locator('[data-id="14"]').count()==0;a.screenshot(path=S+'12-admin-after-reset.png',full_page=True);print('admin reset OK')
    p2.reload();p2.wait_for_selector('.team-choice');p2.click('.team-choice[data-id="14"]');p2.wait_for_selector('.pin-boxes input')
    assert 'First time here' in p2.content();print('after reset: create-PIN prompt shown, old session revoked OK')
    pg.goto(B);pg.wait_for_selector('.team-choice');pg.click('#pub');pg.wait_for_timeout(800);pg.screenshot(path=S+'13-public-league.png')
    print('page errors:',errs);br.close()
