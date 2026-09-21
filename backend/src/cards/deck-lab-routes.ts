import type { FastifyInstance } from 'fastify';
import type { LabSearchQuery } from '../../../shared/deck-lab.js';
import { DeckLabSearch } from './deck-lab-search.js';
export function registerDeckLabRoutes(app: FastifyInstance, service = new DeckLabSearch()) {
  app.addHook('onClose',()=>service.close());
  app.get('/cards/search/catalog',()=>service.getCatalog());
  const shortText = {type:'string',maxLength:250};
  app.post<{Body: LabSearchQuery}>('/cards/search', {schema:{body:{
    type:'object',additionalProperties:false,properties:{
      query:shortText,name:shortText,oracle:shortText,colors:shortText,identity:shortText,manaValue:shortText,
      rarity:{type:'string',enum:['','common','uncommon','rare','mythic','special','bonus']},language:{type:'string',maxLength:8},
      raw:{type:'string',maxLength:1000},
      types:{type:'array',maxItems:30,items:shortText},sets:{type:'array',maxItems:100,items:{type:'string',maxLength:20}},
      unique:{type:'string',enum:['cards','prints']},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:120},
    },
  }}},request=>service.search(request.body));
}
