import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const packageSpec = `${packageJson.name}@${packageJson.version}`

function setPublished(value) {
    const outputPath = process.env.GITHUB_OUTPUT
    if (outputPath !== undefined) {
        appendFileSync(outputPath, `published=${value}\n`)
    }
}

let registryIntegrity

try {
    registryIntegrity = JSON.parse(
        execFileSync('npm', ['view', packageSpec, 'dist.integrity', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    )
} catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    if (!output.includes('E404')) {
        throw error
    }

    setPublished('false')
    console.log(`${packageSpec} is not published yet.`)
    process.exit(0)
}

const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    })
)

if (packed.integrity !== registryIntegrity) {
    throw new Error(
        `${packageSpec} already exists on npm with different package contents.`
    )
}

setPublished('true')
console.log(`${packageSpec} is already published with identical contents.`)
