"use server";

import { exposer } from "@/server/actions/exposer";

import { demoCompte } from "../../declarations";

export const agirCompte = exposer(demoCompte);
