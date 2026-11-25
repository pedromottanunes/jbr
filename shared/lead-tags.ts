export type TagCategory='origem'|'atendimento'|'servico'|'responsavel'|'outras';
const categories:Record<TagCategory,string[]>={
 origem:['GOOGLE','GOOGLE ADS','INSTAGRAM','FACEBOOK','CHATGPT','INDICACAO'],
 atendimento:['NOVO CHAT','SEM RESPOSTA','NAO RESPONDEU','CLIENTE RESPONDEU','AGUARDANDO','AGUARD PAG','AGUARDANDO PAGAMENTO','AGUARD LIB','AGUARDANDO LIBERACAO','VENDA OK','PAGAMENTO FINALIZADO','NEGOCIACAO','ENGANO','FORA HORARIO','POS AGEND','POS 15 DIAS','POS DIA SEGUINTE','POS 5 DIAS','FERNANDO ACOMPANHAR'],
 servico:['ANTT','ANTT 0800','TAC','ETC','CURSO','CURSO 041','CONSULTA','RENOVACAO CADASTRO','DESPACHANTE','PASSAGEIROS','REVALIDACAO','REVALIDACAO ETC','REVALIDACAO NAO DISPONIVEL','NOTA FISCAL'],
 responsavel:['RAFAELE','THAINA','FLAVIA','CLIENTE RAFAELE','RAFAELE CLIENTE','CLIENTE FLAVIA','FLAVIA CLIENTE','ALEXANDRE'],outras:[]
};
export function tagCategory(name:string):TagCategory{const normalized=name.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().trim().replace(/\s+/g,' ');return (Object.keys(categories) as TagCategory[]).find(k=>categories[k].includes(normalized))??'outras';}
export function groupTags<T extends {name:string}>(tags:T[]):Record<TagCategory,T[]>{const grouped:Record<TagCategory,T[]>={origem:[],atendimento:[],servico:[],responsavel:[],outras:[]};for(const tag of tags)grouped[tagCategory(tag.name)].push(tag);return grouped;}
