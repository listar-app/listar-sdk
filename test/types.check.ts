import type * as C from '../src/client';
type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends false> = T;
export type Checks = [
  Assert<IsNever<C.PersonQuery>>,
  Assert<IsNever<C.PersonResult>>,
  Assert<IsNever<C.BulkEnrichRequest>>,
  Assert<IsNever<C.BulkEnrichAccepted>>,
  Assert<IsNever<C.VerifyEmailsResult>>,
  Assert<IsNever<C.VerifyWhatsappRequest>>,
  Assert<IsNever<C.VerifyWhatsappResult>>,
  Assert<IsNever<C.VerifyPhoneOwnershipRequest>>,
  Assert<IsNever<C.VerifyPhoneOwnershipResult>>,
  Assert<IsNever<C.CreditTransactions>>,
  Assert<IsNever<C.ApiKeyList>>,
  Assert<IsNever<C.CreateApiKeyRequest>>,
  Assert<IsNever<C.CreatedApiKey>>,
  Assert<IsNever<C.CompanyListRequest>>,
  Assert<IsNever<C.CompanyListLaunched>>,
  Assert<IsNever<C.CompanyListResult>>,
  Assert<IsNever<C.CompanyListProgress>>,
  Assert<IsNever<C.CompanyContactsRequest>>,
  Assert<IsNever<C.CompanyContactsLaunched>>,
  Assert<IsNever<C.CompanyContactsResult>>,
];
