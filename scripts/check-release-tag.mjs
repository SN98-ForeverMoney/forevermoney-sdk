import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const expectedTag = `v${packageJson.version}`
const actualTag = process.env.GITHUB_REF_NAME

if (actualTag !== expectedTag) {
    throw new Error(
        `Release tag ${actualTag ?? '(missing)'} does not match package version ${packageJson.version}; expected ${expectedTag}.`
    )
}

console.log(
    `Release tag ${actualTag} matches package version ${packageJson.version}.`
)
