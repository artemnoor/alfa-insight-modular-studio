"""Read-only profiling of the three downloaded CSVs. Writes reports beside them."""
from pathlib import Path
import hashlib
import json
import pandas as pd

ROOT = Path(__file__).resolve().parent
FILES = ['df_Uid_data_hack.csv', 'df_Fid_Uid_link_hack.csv', 'df_Uid_payment_hack.csv']
c, f, p = [pd.read_csv(ROOT / n, sep=';', dtype=str, encoding='utf-8-sig') for n in FILES]
out = {'files': {}, 'columns': {}}
for name, df in zip(FILES, [c, f, p]):
    out['files'][name] = {'bytes': (ROOT/name).stat().st_size,
        'sha256': hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),
        'rows': len(df), 'columns': list(df.columns), 'duplicate_full_rows': int(df.duplicated().sum())}
    out['columns'][name] = {col: {'nulls': int(df[col].isna().sum()),
        'distinct': int(df[col].nunique()), 'top': df[col].value_counts(dropna=False).head(8).to_dict()}
        for col in df.columns}

uids = set(c.SYNTHETIC_U.dropna())
fuid, payer, beneficiary = [set(s.dropna()) for s in [f.SYNTHETIC_U, p.PAYER, p.BENEFICIARY]]
alluids = uids | fuid | payer | beneficiary
out['keys'] = {'companies_unique': len(uids), 'company_key_duplicates': int(c.SYNTHETIC_U.duplicated().sum()),
    'people_unique': int(f.SYNTHETIC_F.nunique()), 'link_companies_unique': len(fuid),
    'link_company_missing_from_cards': len(fuid-uids), 'payer_unique': len(payer),
    'beneficiary_unique': len(beneficiary), 'payment_companies_unique': len(payer|beneficiary),
    'payment_companies_missing_from_cards': len((payer|beneficiary)-uids),
    'all_company_nodes': len(alluids), 'link_pair_duplicates': int(f.duplicated(['SYNTHETIC_F','SYNTHETIC_U']).sum()),
    'payment_directed_pair_duplicates': int(p.duplicated(['PAYER','BENEFICIARY']).sum()),
    'identifier_whitespace': {name: {k: int((df[k].dropna()!=df[k].dropna().str.strip()).sum()) for k in keys}
        for name, df, keys in [('companies',c,['SYNTHETIC_U','GROUP_ID']),('links',f,['SYNTHETIC_U','SYNTHETIC_F']),('payments',p,['PAYER','BENEFICIARY'])]}}

out['numeric']={}
for df, col in [(c,'REVENUE_COMPANY'),(p,'PAY_AMT'),(p,'PAY_CNT')]:
    n=pd.to_numeric(df[col],errors='coerce')
    out['numeric'][col]={'parse_failures':int((df[col].notna()&n.isna()).sum()),'nulls':int(n.isna().sum()),
        'negative':int((n<0).sum()), 'zero':int((n==0).sum()),'noninteger':int((n.dropna()%1!=0).sum()),
        'min':n.min(),'max':n.max(),'median':n.median(),'sum':n.sum()}

pc = p.PAYER.isin(uids); bc = p.BENEFICIARY.isin(uids)
out['coverage']={'payment_rows_both_cards':int((pc&bc).sum()),'payment_rows_only_payer_card':int((pc&~bc).sum()),
    'payment_rows_only_beneficiary_card':int((~pc&bc).sum()),'payment_rows_neither_card':int((~pc&~bc).sum()),
    'link_rows_company_card_found':int(f.SYNTHETIC_U.isin(uids).sum()),
    'company_cards_with_payments':len(uids&(payer|beneficiary)), 'company_cards_with_person_links':len(uids&fuid),
    'company_cards_with_both':len(uids&(payer|beneficiary)&fuid),
    'company_cards_with_neither':len(uids-(payer|beneficiary)-fuid),
    'self_payments':int(p.PAYER.eq(p.BENEFICIARY).sum())}

ambiguous=set(c.loc[c.SYNTHETIC_U.duplicated(False),'SYNTHETIC_U'])
safe_c=c.loc[~c.SYNTHETIC_U.isin(ambiguous)]
out['company_conflicts']={'ambiguous_ids':sorted(ambiguous),'rows':int(c.SYNTHETIC_U.isin(ambiguous).sum()),
    'conflicting_columns':c[c.SYNTHETIC_U.isin(ambiguous)].groupby('SYNTHETIC_U').nunique(dropna=False).gt(1).sum().to_dict(),
    'payment_rows_touching_ambiguous_ids':int((p.PAYER.isin(ambiguous)|p.BENEFICIARY.isin(ambiguous)).sum()),
    'person_links_touching_ambiguous_ids':int(f.SYNTHETIC_U.isin(ambiguous).sum())}
group_sizes=safe_c.groupby('GROUP_ID').SYNTHETIC_U.nunique().sort_values(ascending=False)
groupmap=safe_c.set_index('SYNTHETIC_U').GROUP_ID
gp=p.PAYER.map(groupmap); gb=p.BENEFICIARY.map(groupmap)
same=gp.notna()&gb.notna()&gp.eq(gb)
amount=pd.to_numeric(p.PAY_AMT)
out['groups']={'unique':len(group_sizes),'single_company_groups':int(group_sizes.eq(1).sum()),
    'multi_company_groups':int(group_sizes.gt(1).sum()),'companies_in_multi_groups':int(group_sizes[group_sizes.gt(1)].sum()),
    'size_max':int(group_sizes.max()),'size_distribution':group_sizes.value_counts().sort_index().to_dict(),
    'largest':group_sizes.head(10).to_dict(),'payment_rows_within_group':int(same.sum()),
    'payment_rows_between_groups':int((gp.notna()&gb.notna()&gp.ne(gb)).sum()),
    'payment_amount_within_group':amount[same].sum(),'payment_amount_both_cards':amount[pc&bc].sum(),
    'note':'Group analysis excludes ambiguous company IDs; original files are unchanged.'}

fd=f[['SYNTHETIC_F','SYNTHETIC_U']].drop_duplicates()
per_person=fd.groupby('SYNTHETIC_F').SYNTHETIC_U.nunique()
per_company=fd.groupby('SYNTHETIC_U').SYNTHETIC_F.nunique()
fg=fd.assign(GROUP_ID=fd.SYNTHETIC_U.map(groupmap))
geo=f.groupby('SYNTHETIC_F')[['CITY_NAME','RC_NAME']].nunique()
out['people']={'companies_per_person_distribution':per_person.value_counts().sort_index().to_dict(),
    'persons_linked_to_multiple_companies':int(per_person.gt(1).sum()),'max_companies_per_person':int(per_person.max()),
    'persons_per_company_distribution':per_company.value_counts().sort_index().to_dict(),
    'persons_with_multiple_city_values':int(geo.CITY_NAME.gt(1).sum()),'persons_with_multiple_region_values':int(geo.RC_NAME.gt(1).sum()),
    'persons_with_multiple_known_groups':int(fg.groupby('SYNTHETIC_F').GROUP_ID.nunique().gt(1).sum())}

pairs=fd.merge(fd,on='SYNTHETIC_F',suffixes=('_a','_b'))
pairs=pairs[pairs.SYNTHETIC_U_a<pairs.SYNTHETIC_U_b]
shared=pairs.groupby(['SYNTHETIC_U_a','SYNTHETIC_U_b']).SYNTHETIC_F.agg(['nunique',list]).reset_index()
shared.columns=['a','b','shared_people_count','shared_people']
shared['group_a']=shared.a.map(groupmap); shared['group_b']=shared.b.map(groupmap)
shared['same_known_group']=shared.group_a.notna()&shared.group_b.notna()&shared.group_a.eq(shared.group_b)
shared['different_known_groups']=shared.group_a.notna()&shared.group_b.notna()&shared.group_a.ne(shared.group_b)
pairkeys=pd.MultiIndex.from_frame(shared[['a','b']])
lo=p.PAYER.where(p.PAYER<p.BENEFICIARY,p.BENEFICIARY)
hi=p.BENEFICIARY.where(p.PAYER<p.BENEFICIARY,p.PAYER)
sharedmask=pd.MultiIndex.from_arrays([lo,hi]).isin(pairkeys)
out['shared_person_pairs']={'unique_company_pairs':len(shared),'within_known_group':int(shared.same_known_group.sum()),
    'between_known_groups':int(shared.different_known_groups.sum()),
    'pairs_missing_at_least_one_card':int((shared.group_a.isna()|shared.group_b.isna()).sum()),
    'shared_people_max':int(shared.shared_people_count.max()) if len(shared) else 0,
    'payment_rows_between_shared_person_companies':int(sharedmask.sum()),
    'payment_rows_shared_person_and_same_group':int((sharedmask&same).sum())}

# Joining both many-to-many link tables onto payments multiplies the payment facts.
counts=per_company.to_dict()
mult=p.PAYER.map(counts).fillna(1).astype('int64')*p.BENEFICIARY.map(counts).fillna(1).astype('int64')
out['join_inflation']={'original_payment_rows':len(p),'rows_after_two_left_joins_to_raw_person_links':int(mult.sum()),
    'rows_replicated':int(mult.gt(1).sum()),'max_multiplier':int(mult.max()),
    'amount_before':amount.sum(),'amount_after_naive_join':(amount*mult).sum()}

directed=pd.MultiIndex.from_frame(p[['PAYER','BENEFICIARY']])
reverse=pd.MultiIndex.from_frame(p[['BENEFICIARY','PAYER']])
out['payment_graph']={'rows_with_reverse_direction':int(reverse.isin(directed).sum()),
    'largest_outdegree':int(p.groupby('PAYER').BENEFICIARY.nunique().max()),
    'largest_indegree':int(p.groupby('BENEFICIARY').PAYER.nunique().max())}
selfmask=p.PAYER.eq(p.BENEFICIARY)
out['groups']['payment_rows_within_group_between_distinct_companies']=int((same&~selfmask).sum())
out['groups']['payment_amount_within_group_between_distinct_companies']=amount[same&~selfmask].sum()
out['payment_graph']['self_payment_amount']=amount[selfmask].sum()
duplicate_payments=p[p.duplicated(['PAYER','BENEFICIARY'],keep=False)]
out['payment_duplicates']={'participating_rows':len(duplicate_payments),
    'directed_pairs':len(duplicate_payments[['PAYER','BENEFICIARY']].drop_duplicates()),
    'rows_touching_ambiguous_company':int((duplicate_payments.PAYER.isin(ambiguous)|duplicate_payments.BENEFICIARY.isin(ambiguous)).sum()),
    'examples':duplicate_payments.head(8).to_dict(orient='records')}
out['fts']={'flag_one_country_missing':int((c.FTS_FLAG.eq('1.0')&c.FTS_COUNTRY_NAME.isna()).sum()),
    'flag_zero_country_present':int((c.FTS_FLAG.eq('0.0')&c.FTS_COUNTRY_NAME.notna()).sum()),
    'rows_containing_country_lists':int(c.FTS_COUNTRY_NAME.str.contains(',',na=False).sum())}
out['join_inflation']['rows_after_two_raw_company_card_left_joins']=int((p.PAYER.map(c.SYNTHETIC_U.value_counts()).fillna(1)*p.BENEFICIARY.map(c.SYNTHETIC_U.value_counts()).fillna(1)).sum())
try:
    import numpy as np
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    allids=pd.Index(sorted(alluids)); ii=allids.get_indexer(p.PAYER); jj=allids.get_indexer(p.BENEFICIARY)
    graph=coo_matrix((np.ones(len(p),dtype=np.int8),(ii,jj)),shape=(len(allids),len(allids))).tocsr()
    ncomp,labels=connected_components(graph,directed=False)
    sizes=pd.Series(labels).value_counts()
    out['payment_graph'].update({'weak_components_including_all_company_nodes':int(ncomp),
        'largest_weak_component':int(sizes.max()),'isolated_company_nodes':int(sizes.eq(1).sum())})
except ImportError:
    pass

# Preserve a concrete, verifiable chain for the explanation.
examples=[]
payment_pairkeys=pd.MultiIndex.from_arrays([lo,hi])
shared['has_payment']=pd.MultiIndex.from_frame(shared[['a','b']]).isin(payment_pairkeys)
for row in shared.sort_values(['has_payment','same_known_group','shared_people_count'],ascending=False).head(4).itertuples():
    pay=p[((p.PAYER==row.a)&(p.BENEFICIARY==row.b))|((p.PAYER==row.b)&(p.BENEFICIARY==row.a))]
    examples.append({'a':row.a,'b':row.b,'shared_people':row.shared_people,'group_a':row.group_a,'group_b':row.group_b,
        'payments':pay.to_dict(orient='records')})
out['examples']=examples

def clean(v):
    if isinstance(v,dict): return {str(k):clean(x) for k,x in v.items()}
    if isinstance(v,list): return [clean(x) for x in v]
    if isinstance(v,tuple): return [clean(x) for x in v]
    if hasattr(v,'item'): return clean(v.item())
    if isinstance(v,float) and pd.isna(v): return None
    return v
out=clean(out)
(ROOT/'profile.json').write_text(json.dumps(out,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
summary={k:v for k,v in out.items() if k!='columns'}
print(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False))
