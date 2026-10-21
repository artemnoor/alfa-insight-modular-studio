import test from 'node:test'
import assert from 'node:assert/strict'
import { rankEntityCandidates } from '../src/entity-resolution.mjs'

test('sends bounded same-type candidates to JEV and maps the selected choice to an entity id', async () => {
  let request
  const source = { entity_id:'source-id', entity_type:'COMPANY', canonical_name:'ООО «Насос»', identifiers:{}, attributes:{}, mentions:[{quote:'ООО «Насос» производит насосы.'}] }
  const candidate = { entity_id:'candidate-id', entity_type:'COMPANY', canonical_name:'ООО «Насос»', identifiers:{}, attributes:{}, similarity:0.93 }
  const result = await rankEntityCandidates([{entity:source,candidates:[candidate]}], {
    apiKeyOverride:'unit-test-key',
    fetchImpl:async (url,init) => {
      request={url:String(url),init,body:JSON.parse(init.body)}
      return {ok:true,json:async()=>({model:'typesafe/jev',answers:{entity_1:{choice:'candidate_1',confidence:0.96,probabilities:{candidate_1:0.96,none:0.04}}},usage:{input_tokens:25,output_tokens:4,cost_rub:0.0001}})}
    },
  })
  assert.match(request.url,/systemone$/u)
  assert.equal(request.init.headers.authorization,'Bearer unit-test-key')
  assert.equal(request.body.model,'typesafe/jev')
  assert.equal(result.rankings[0].selected.entityId,'candidate-id')
  assert.equal(result.rankings[0].confidence,0.96)
  assert.equal(result.usage.inputTokens,25)
})
