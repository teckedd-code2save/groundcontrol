import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentProposalConfiguration } from "./AgentProposalConfiguration";
const fetchMock=vi.fn(); let node:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();node=document.createElement("div");document.body.appendChild(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();});
it("loads saved metadata without requesting or displaying secret values",async()=>{
 fetchMock.mockResolvedValue({ok:true,json:async()=>({revision:2,keys:[{service:"app",key:"MODEL_KEY",required:true,saved:true,version:2}]})});
 await act(async()=>root.render(<AgentProposalConfiguration proposalId="p1" contentHash="hash" disabled={false} onSaved={()=>{}}/>));
 expect(fetchMock).toHaveBeenCalledWith("/api/agent-proposals/p1/configuration",{cache:"no-store"});
 expect(node.textContent).toContain("app.MODEL_KEY");expect(node.textContent).toContain("Nothing is copied from production");
 expect(node.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
});
it("does not send configuration without a deliberate owner action",async()=>{
 fetchMock.mockResolvedValue({ok:true,json:async()=>({revision:0,keys:[]})});
 await act(async()=>root.render(<AgentProposalConfiguration proposalId="p1" contentHash="hash" disabled={false} onSaved={()=>{}}/>));
 expect(fetchMock).toHaveBeenCalledTimes(1);
 expect([...node.querySelectorAll("button")].find(x=>x.textContent==="Save entered values")?.disabled).toBe(true);
});
