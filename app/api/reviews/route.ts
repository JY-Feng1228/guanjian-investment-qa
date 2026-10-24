import { handle } from "@/lib/api";
export async function POST(request:Request) {return handle(request,"reviews");}
