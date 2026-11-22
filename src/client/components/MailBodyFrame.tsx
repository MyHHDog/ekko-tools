import {useMemo} from 'react';
import {frameDocument} from '../sanitize/html-allowlist';
export function MailBodyFrame({html,zoom=100}:{html:string;zoom?:number}){
  const srcDoc=useMemo(()=>frameDocument(html,false,'mail',undefined,false,zoom),[html,zoom]);
  return <div className="body-frame"><iframe title="安全邮件正文" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc}/></div>;
}
