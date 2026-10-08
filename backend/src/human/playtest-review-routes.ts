import type { FastifyInstance } from 'fastify';
import type { PlaytestReviewService } from './playtest-review-service.js';
const identifier = {type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'};
const params = {type:'object',additionalProperties:false,required:['sessionId'],properties:{sessionId:identifier}};
export function registerPlaytestReviewRoutes(app: FastifyInstance, reviews: PlaytestReviewService) {
  app.get<{Querystring:{projectId?:string;offset?:number}}>('/playtests/reviews',{schema:{querystring:{type:'object',additionalProperties:false,
    properties:{projectId:identifier,offset:{type:'integer',minimum:0,maximum:1000000}}}}},request=>reviews.list(request.query.projectId,request.query.offset));
  app.get<{Params:{sessionId:string}}>('/playtests/reviews/:sessionId',{schema:{params}},request=>reviews.get(request.params.sessionId));
  app.put<{Params:{sessionId:string};Body:{revision:number;feedback:unknown}}>('/playtests/reviews/:sessionId/feedback',{
    bodyLimit:8_000_000,schema:{params,body:{type:'object',additionalProperties:false,required:['revision','feedback'],
      properties:{revision:{type:'integer',minimum:0,maximum:1000000000},feedback:{type:'object'}}}}},request=>reviews.feedback(request.params.sessionId,request.body.revision,request.body.feedback));
}
