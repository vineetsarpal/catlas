import importedContract from './main-contract.json';
import { contractSchema } from '../parametric/types';
export const mainContract = contractSchema.parse(importedContract);
