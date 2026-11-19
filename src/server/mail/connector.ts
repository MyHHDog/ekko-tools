import type { Account, ConnectionState, MailSummary } from '../../shared/types';
import type { RawMail } from './parse';
export interface Credentials {account:Account;secret:string}
export interface ReplyMessage {
  to:string;
  subject:string;
  text:string;
  html?:string;
  inReplyTo?:string;
  references?:string[];
}
export interface ReplyResult {messageId?:string}
export interface Connector {
  test(acc:Credentials,signal:AbortSignal):Promise<ConnectionState>;
  list(acc:Credentials,q:{cursor?:string;limit:number},signal:AbortSignal):Promise<{items:MailSummary[];nextCursor?:string;reset?:boolean}>;
  olderCursor?(acc:Credentials,messageIds:string[],signal:AbortSignal):Promise<string|undefined>;
  fetch(acc:Credentials,messageId:string,signal:AbortSignal):Promise<RawMail>;
  seen?(acc:Credentials,messageIds:string[],signal:AbortSignal):Promise<Record<string,boolean>>;
  markRead?(acc:Credentials,messageId:string,read:boolean,signal:AbortSignal):Promise<void>;
  markReadMany?(acc:Credentials,messageIds:string[],read:boolean,signal:AbortSignal):Promise<void>;
  reply?(acc:Credentials,message:ReplyMessage,signal:AbortSignal):Promise<ReplyResult>;
  close():void;
  closeAccount?(id:string):void;
}
