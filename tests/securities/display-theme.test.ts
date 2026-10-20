import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { displayPreferencesBootstrap, DISPLAY_STORAGE_KEY, THEME_MODE_STORAGE_KEY } from '../../src/lib/preferences';

test('appearance is resolved before paint: system, explicit overrides, legacy settings and unavailable storage', () => {
  for (const scenario of [
    {systemLight:true, expected:'light'}, {systemLight:false, expected:'dark'},
    {systemLight:true, theme:'dark', expected:'dark'},
    {systemLight:false, theme:'light', expected:'light'},
    {systemLight:true, theme:'dark', mode:'system', expected:'light'},
    {systemLight:false, theme:'light', mode:'dark', expected:'dark'},
    {systemLight:true, theme:'dark', resolvedMode:'system', expected:'light'},
    {systemLight:true, broken:true, expected:'light'},
    {systemLight:false, invalid:true, expected:'dark'},
  ]) {
    const dataset:Record<string,string>={};
    vm.runInNewContext(displayPreferencesBootstrap, {
      document:{documentElement:{dataset}}, matchMedia:()=>({matches:scenario.systemLight}),
      localStorage:{getItem:(key:string)=>{
        if(scenario.broken)throw new Error('Storage blocked');
        if(key===THEME_MODE_STORAGE_KEY)return scenario.mode??null;
        if(key===DISPLAY_STORAGE_KEY)return scenario.invalid?'invalid json':JSON.stringify({theme:scenario.theme,resolvedThemeMode:scenario.resolvedMode,priceColors:'red-up'});
        return null;
      }},
    });
    assert.equal(dataset.theme,scenario.expected,JSON.stringify(scenario));
    assert.equal(dataset.priceColors,scenario.broken||scenario.invalid?'green-up':'red-up');
  }
});
