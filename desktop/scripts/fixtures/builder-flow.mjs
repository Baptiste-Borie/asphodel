import {readFile} from 'node:fs/promises';

// Public deck DTOs and a writable project fixture, independent of Forge and user data.
export async function builderFixture() {
  const cards=JSON.parse(await readFile(new URL('../../../frontend/src/deck-lab/cards.json',import.meta.url),'utf8')).slice(0,13);
  const groups=[{id:'commander',name:'Commandant',commander:true,entries:[{id:'entry0',card:cards[0],quantity:1}]},
    {id:'main',name:'Idées à explorer',entries:cards.slice(1,9).map((card,i)=>({id:`entry${i+1}`,card,quantity:1}))},
    {id:'maybe',name:'À tester',maybeboard:true,entries:cards.slice(9,12).map((card,i)=>({id:`entry${i+9}`,card,quantity:1}))}];
  return {project:{version:1,projectId:'builder-smoke',name:'Kodama — Jardins en mouvement',groups,cuts:[],workspace:{version:1,cards:[],zones:[],camera:{x:0,y:0,zoom:1}}},candidate:cards[12]};
}
export function installBuilderFixture(fixture) {
  const original=window.fetch.bind(window);
  window.builderSmoke={project:structuredClone(fixture.project),writes:0};
  const detail=()=>({id:1,name:window.builderSmoke.project.name,totalCards:9,cards:[],project:window.builderSmoke.project});
  window.fetch=async(input,options={})=>{
    const url=typeof input==='string'?input:input.url;
    if(url==='/decks')return Response.json({decks:[{id:1,name:detail().name,totalCards:9,commanders:[{name:fixture.project.groups[0].entries[0].card.name,imageUri:null}]}]});
    if(url==='/decks/1')return Response.json(detail());
    if(url==='/decks/1/project'){
      window.builderSmoke.project=JSON.parse(options.body);window.builderSmoke.writes++;
      return Response.json(detail());
    }
    if(url==='/cards/search')return Response.json({cards:[fixture.candidate],total:1,nextOffset:null,catalogPrintings:1,snapshotDate:'2026-10-09'});
    return original(input,options);
  };
}
