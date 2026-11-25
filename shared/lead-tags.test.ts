import {expect,it} from 'vitest';
import {groupTags,tagCategory} from './lead-tags';
it('organiza etiquetas conhecidas sem atribuir origem paga ou descartar desconhecidas',()=>{
 expect(tagCategory('Google ADS')).toBe('origem');expect(tagCategory('Indicação')).toBe('origem');
 expect(tagCategory('Negociação')).toBe('atendimento');expect(tagCategory('VENDA OK')).toBe('atendimento');
 expect(tagCategory('Renovação cadastro')).toBe('servico');expect(tagCategory('FLÁVIA')).toBe('responsavel');expect(tagCategory('166')).toBe('outras');
 const grouped=groupTags([{name:'Google'},{name:'Instagram'},{name:'166'}]);expect(grouped.origem.map(t=>t.name)).toEqual(['Google','Instagram']);expect(grouped.outras[0].name).toBe('166');
});
