import type {BuilderProject} from '../../../shared/builder-project.mjs';
const card=(name:string)=>({name,type_line:name==='Mountain'?'Basic Land':'Creature',cmc:0,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'',set_name:'',collector_number:'',rarity:'',lang:'en',color_identity:['R'],image:'',related:[]});
export function project():BuilderProject {
  const groups=[{id:'commanders',name:'Commander',commander:true,entries:[{id:'krenko',card:card('Krenko'),quantity:1}]},
    {id:'main',name:'Mainboard',entries:[{id:'mountain',card:card('Mountain'),quantity:98}]},
    {id:'maybe',name:'Candidates',maybeboard:true,entries:[{id:'candidate',card:card('Candidate'),quantity:1}]}];
  const state={name:'Deck',groups,cuts:[card('Cut')],workspace:{version:1 as const,cards:[],zones:[],camera:{x:0,y:0,zoom:1}}};
  const before=structuredClone(state);before.groups[1]!.entries[0]!.quantity=99;
  return {...state,version:1,projectId:'deck-project',versions:[{id:'base',name:'Base',createdAt:'2026-10-08T09:00:00.000Z',state:before}]};
}
