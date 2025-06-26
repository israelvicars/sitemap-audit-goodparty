// scripts/validateSitemapFiles.js
// Run this script to validate actual generated sitemap XML files

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import fetch from 'node-fetch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Sitemap schema requirements
const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const VALID_CHANGEFREQ = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']
const MAX_URLS_PER_SITEMAP = 50000
const MAX_SITEMAP_SIZE = 50 * 1024 * 1024 // 50MB

class SitemapValidator {
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    })
    this.errors = []
    this.warnings = []
  }

  /**
   * Validate a sitemap file from disk
   */
  async validateFile(filePath) {
    console.log(`\nValidating: ${filePath}`)
    this.errors = []
    this.warnings = []

    try {
      const content = await fs.readFile(filePath, 'utf8')
      return this.validateContent(content, filePath)
    } catch (error) {
      this.errors.push(`Failed to read file: ${error.message}`)
      return this.getResults()
    }
  }

  /**
   * Validate a sitemap from URL
   */
  async validateUrl(url, options = { recursive: false, depth: 0, maxDepth: 3 }) {
    const indent = '  '.repeat(options.depth || 0)
    console.log(`${indent}\nValidating URL: ${url}`)
    this.errors = []
    this.warnings = []

    try {
      const response = await fetch(url)
      
      if (!response.ok) {
        this.errors.push(`HTTP ${response.status}: ${response.statusText}`)
        return this.getResults()
      }

      const content = await response.text()
      const results = this.validateContent(content, url, options)
      
      // If recursive validation is enabled and this is a sitemap index
      if (options.recursive && results.childSitemaps && results.childSitemaps.length > 0 && options.depth < options.maxDepth) {
        results.childResults = {}
        
        console.log(`${indent}  Found ${results.childSitemaps.length} child sitemaps`)
        
        // Limit the number of child sitemaps to process to avoid overwhelming the server
        const maxChildSitemaps = options.depth === 0 ? results.childSitemaps.length : 10
        const childSitemapsToProcess = results.childSitemaps.slice(0, maxChildSitemaps)
        
        if (childSitemapsToProcess.length < results.childSitemaps.length) {
          console.log(`${indent}  Processing first ${maxChildSitemaps} child sitemaps...`)
        }
        
        for (const childUrl of childSitemapsToProcess) {
          const childValidator = new SitemapValidator()
          const childOptions = {
            ...options,
            depth: options.depth + 1
          }
          results.childResults[childUrl] = await childValidator.validateUrl(childUrl, childOptions)
        }
        
        if (childSitemapsToProcess.length < results.childSitemaps.length) {
          results.warnings.push(`Only validated ${maxChildSitemaps} of ${results.childSitemaps.length} child sitemaps`)
        }
      }
      
      return results
    } catch (error) {
      this.errors.push(`Failed to fetch URL: ${error.message}`)
      return this.getResults()
    }
  }

  /**
   * Validate sitemap content
   */
  validateContent(content, source, options = {}) {
    // Check file size
    const sizeInBytes = Buffer.byteLength(content, 'utf8')
    if (sizeInBytes > MAX_SITEMAP_SIZE) {
      this.errors.push(`File size (${(sizeInBytes / 1024 / 1024).toFixed(2)}MB) exceeds 50MB limit`)
    }

    // Validate XML structure
    const xmlValidation = XMLValidator.validate(content, {
      allowBooleanAttributes: true,
    })

    if (xmlValidation !== true) {
      this.errors.push(`Invalid XML: ${JSON.stringify(xmlValidation)}`)
      return this.getResults()
    }

    // Parse XML
    let parsed
    try {
      parsed = this.parser.parse(content)
    } catch (error) {
      this.errors.push(`XML parsing error: ${error.message}`)
      return this.getResults()
    }

    // Check if it's a sitemap index or regular sitemap
    if (parsed.sitemapindex) {
      return this.validateSitemapIndex(parsed.sitemapindex, source, options)
    } else if (parsed.urlset) {
      return this.validateUrlset(parsed.urlset, source)
    } else {
      this.errors.push('Root element must be either <urlset> or <sitemapindex>')
      return this.getResults()
    }
  }

  /**
   * Validate sitemap index
   */
  validateSitemapIndex(sitemapindex, source) {
    console.log('  Type: Sitemap Index')

    // Check namespace
    if (!sitemapindex['@_xmlns'] || !sitemapindex['@_xmlns'].includes('sitemaps.org')) {
      this.errors.push('Missing or invalid xmlns namespace')
    }

    // Get sitemaps
    const sitemaps = Array.isArray(sitemapindex.sitemap) 
      ? sitemapindex.sitemap 
      : (sitemapindex.sitemap ? [sitemapindex.sitemap] : [])

    console.log(`  Sitemaps: ${sitemaps.length}`)

    if (sitemaps.length === 0) {
      this.warnings.push('Sitemap index contains no sitemaps')
    }

    // Validate each sitemap entry
    sitemaps.forEach((sitemap, index) => {
      if (!sitemap.loc) {
        this.errors.push(`Sitemap ${index + 1}: Missing required <loc> element`)
      } else if (!this.isValidUrl(sitemap.loc)) {
        this.errors.push(`Sitemap ${index + 1}: Invalid URL: ${sitemap.loc}`)
      }

      if (sitemap.lastmod && !this.isValidDate(sitemap.lastmod)) {
        this.warnings.push(`Sitemap ${index + 1}: Invalid lastmod date: ${sitemap.lastmod}`)
      }
    })

    return this.getResults()
  }

  /**
   * Validate regular sitemap (urlset)
   */
  validateUrlset(urlset, source) {
    console.log('  Type: URL Sitemap')

    // Check namespace
    if (!urlset['@_xmlns'] || !urlset['@_xmlns'].includes('sitemaps.org')) {
      this.errors.push('Missing or invalid xmlns namespace')
    }

    // Get URLs
    const urls = Array.isArray(urlset.url) 
      ? urlset.url 
      : (urlset.url ? [urlset.url] : [])

    console.log(`  URLs: ${urls.length}`)

    if (urls.length === 0) {
      this.warnings.push('Sitemap contains no URLs')
    }

    if (urls.length > MAX_URLS_PER_SITEMAP) {
      this.errors.push(`Too many URLs (${urls.length}). Maximum is ${MAX_URLS_PER_SITEMAP}`)
    }

    // Track duplicate URLs
    const urlSet = new Set()

    // Validate each URL entry
    urls.forEach((url, index) => {
      // Check required <loc>
      if (!url.loc) {
        this.errors.push(`URL ${index + 1}: Missing required <loc> element`)
        return
      }

      const loc = url.loc['#text'] || url.loc

      // Validate URL format
      if (!this.isValidUrl(loc)) {
        this.errors.push(`URL ${index + 1}: Invalid URL format: ${loc}`)
      }

      // Check for duplicates
      if (urlSet.has(loc)) {
        this.warnings.push(`URL ${index + 1}: Duplicate URL: ${loc}`)
      }
      urlSet.add(loc)

      // Validate optional fields
      if (url.lastmod) {
        const lastmod = url.lastmod['#text'] || url.lastmod
        if (!this.isValidDate(lastmod)) {
          this.warnings.push(`URL ${index + 1}: Invalid lastmod date: ${lastmod}`)
        }
      }

      if (url.changefreq) {
        const changefreq = url.changefreq['#text'] || url.changefreq
        if (!VALID_CHANGEFREQ.includes(changefreq)) {
          this.warnings.push(`URL ${index + 1}: Invalid changefreq: ${changefreq}`)
        }
      }

      if (url.priority) {
        const priority = parseFloat(url.priority['#text'] || url.priority)
        if (isNaN(priority) || priority < 0 || priority > 1) {
          this.warnings.push(`URL ${index + 1}: Invalid priority: ${url.priority}`)
        }
      }

      // Check for common issues
      if (loc.includes(' ')) {
        this.errors.push(`URL ${index + 1}: Contains spaces (should be encoded): ${loc}`)
      }

      if (loc.includes('&') && !loc.includes('&amp;')) {
        this.errors.push(`URL ${index + 1}: Unescaped ampersand: ${loc}`)
      }
    })

    return this.getResults()
  }

  /**
   * Validate URL format
   */
  isValidUrl(url) {
    try {
      const u = new URL(url)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * Validate date format (W3C Datetime)
   */
  isValidDate(date) {
    // Valid formats:
    // YYYY-MM-DD
    // YYYY-MM-DDThh:mm:ss+00:00
    // YYYY-MM-DDThh:mm:ssZ
    const patterns = [
      /^\d{4}-\d{2}-\d{2}$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    ]

    const isValidFormat = patterns.some(pattern => pattern.test(date))
    
    if (!isValidFormat) return false

    // Check if date is actually valid
    const d = new Date(date)
    return !isNaN(d.getTime())
  }

  /**
   * Get validation results
   */
  getResults() {
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    }
  }

  /**
   * Print recursive results in a tree format
   */
  static printRecursiveResults(results, indent = '') {
    for (const [url, result] of Object.entries(results)) {
      console.log(`${indent}${url}`)
      
      if (result.valid) {
        console.log(`${indent}  ✓ Valid`)
      } else {
        console.log(`${indent}  ✗ Invalid`)
      }
      
      if (result.errors.length > 0) {
        console.log(`${indent}  Errors: ${result.errors.length}`)
        result.errors.forEach(error => console.log(`${indent}    - ${error}`))
      }
      
      if (result.warnings.length > 0) {
        console.log(`${indent}  Warnings: ${result.warnings.length}`)
      }
      
      if (result.childResults) {
        console.log(`${indent}  Child sitemaps:`)
        this.printRecursiveResults(result.childResults, indent + '    ')
      }
    }
  }
}

/**
 * Validate multiple sitemap files with recursive option
 */
async function validateMultipleSitemaps(paths, options = { recursive: false }) {
  const validator = new SitemapValidator()
  const results = {}
  let totalErrors = 0
  let totalWarnings = 0
  let totalChildSitemaps = 0

  for (const pathOrUrl of paths) {
    const isUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
    const result = isUrl 
      ? await validator.validateUrl(pathOrUrl, options)
      : await validator.validateFile(pathOrUrl)

    results[pathOrUrl] = result
    totalErrors += result.errors.length
    totalWarnings += result.warnings.length

    // Print results
    if (result.valid) {
      console.log('  ✓ Valid')
    } else {
      console.log('  ✗ Invalid')
    }

    if (result.errors.length > 0) {
      console.log('  Errors:')
      result.errors.forEach(error => console.log(`    - ${error}`))
    }

    if (result.warnings.length > 0) {
      console.log('  Warnings:')
      result.warnings.forEach(warning => console.log(`    - ${warning}`))
    }

    // Print child sitemap results if recursive
    if (options.recursive && result.childResults) {
      totalChildSitemaps += Object.keys(result.childResults).length
      
      for (const [childUrl, childResult] of Object.entries(result.childResults)) {
        totalErrors += childResult.errors.length
        totalWarnings += childResult.warnings.length
      }
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Total files validated: ${paths.length}`)
  if (totalChildSitemaps > 0) {
    console.log(`Total child sitemaps validated: ${totalChildSitemaps}`)
  }
  console.log(`Total errors: ${totalErrors}`)
  console.log(`Total warnings: ${totalWarnings}`)

  return results
}

/**
 * Validate all GoodParty sitemaps recursively
 */
async function validateGoodPartySitemaps(baseUrl = 'https://goodparty.org') {
  console.log(`\nValidating all sitemaps for ${baseUrl}\n`)
  
  // Start with the main sitemap and let it recursively find all child sitemaps
  const mainSitemap = `${baseUrl}/sitemap.xml`
  
  console.log('Starting recursive validation from main sitemap...')
  return validateMultipleSitemaps([mainSitemap], { recursive: true })
}

/**
 * Validate GoodParty's problematic sitemaps specifically
 */
async function validateGoodPartyProblemSitemaps(baseUrl = 'https://goodparty.org') {
  console.log(`\nValidating problematic GoodParty sitemaps at ${baseUrl}\n`)
  
  // Complete list of state/territory codes for GoodParty candidate sitemaps
  const problemStates = [
    'ak', 'al', 'ar', 'az', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
    'ga', 'hi', 'ia', 'id', 'il', 'in', 'ks', 'ky', 'la', 'ma',
    'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc', 'nd', 'ne',
    'nh', 'nj', 'nm', 'nv', 'ny', 'oh', 'ok', 'or', 'pa', 'ri',
    'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv',
    'wy'
  ]
  
  const stateIndexMap = {
    'ak': 0,
    'al': 1,
    'ar': 2,
    'az': 3,
    'ca': 4,
    'co': 5,
    'ct': 6,
    'de': 7,
    'dc': 8,
    'fl': 9,
    'ga': 10,
    'hi': 11,
    'ia': 12,
    'id': 13,
    'il': 14,
    'in': 15,
    'ks': 16,
    'ky': 17,
    'la': 18,
    'ma': 19,
    'md': 20,
    'me': 21,
    'mi': 22,
    'mn': 23,
    'mo': 24,
    'ms': 25,
    'mt': 26,
    'nc': 27,
    'nd': 28,
    'ne': 29,
    'nh': 30,
    'nj': 31,
    'nm': 32,
    'nv': 33,
    'ny': 34,
    'oh': 35,
    'ok': 36,
    'or': 37,
    'pa': 38,
    'ri': 39,
    'sc': 40,
    'sd': 41,
    'tn': 42,
    'tx': 43,
    'ut': 44,
    'va': 45,
    'vt': 46,
    'wa': 47,
    'wi': 48,
    'wv': 49,
    'wy': 50
  }
  
  const results = {}
  let errorCount = 0
  let validCount = 0
  
  for (const state of problemStates) {
    const index = stateIndexMap[state]
    const candidateUrl = `${baseUrl}/sitemaps/candidates/${state}/sitemap/${index}.xml`
    const stateUrl      = `${baseUrl}/sitemaps/state/${state}/sitemap/${index}.xml`

    console.log(`\nChecking ${state.toUpperCase()} candidate sitemap (index ${index})...`)
    const validatorCandidates = new SitemapValidator()
    const candidateResult = await validatorCandidates.validateUrl(candidateUrl)

    if (candidateResult.valid) {
      console.log('  ✓ Valid')
      validCount++
    } else {
      console.log(`  ✗ Invalid - ${candidateResult.errors.join(', ')}`)
      errorCount++
    }

    console.log(`Checking ${state.toUpperCase()} state sitemap (index ${index})...`)
    const validatorState = new SitemapValidator()
    const stateResult = await validatorState.validateUrl(stateUrl)

    if (stateResult.valid) {
      console.log('  ✓ Valid')
      validCount++
    } else {
      console.log(`  ✗ Invalid - ${stateResult.errors.join(', ')}`)
      errorCount++
    }

    // store both results under composite key
    results[state] = {
      candidates: candidateResult,
      state: stateResult,
    }
  }
  
  console.log(`\n=== PROBLEM SITEMAPS SUMMARY ===`)
  console.log(`Valid: ${validCount}`)
  console.log(`Invalid: ${errorCount}`)
  console.log(`\nStates with errors:`)
  
  for (const [state, result] of Object.entries(results)) {
    if (!result.candidates.valid || !result.state.valid) {
      console.log(`  ${state.toUpperCase()}:`)
      if (!result.candidates.valid) {
        console.log(`    Candidates: ${result.candidates.errors.join(', ')}`)
      }
      if (!result.state.valid) {
        console.log(`    State: ${result.state.errors.join(', ')}`)
      }
    }
  }
  
  return results
}

// CLI interface
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage: node validateSitemapFiles.js [options] [file1.xml] [file2.xml] ...')
    console.log('       node validateSitemapFiles.js [options] [url1] [url2] ...')
    console.log('       node validateSitemapFiles.js --goodparty [baseUrl]')
    console.log('       node validateSitemapFiles.js --problem-sitemaps [baseUrl]')
    console.log('\nOptions:')
    console.log('  --recursive         Follow and validate child sitemaps in sitemap indexes')
    console.log('  --goodparty         Validate all GoodParty sitemaps (optionally specify base URL)')
    console.log('  --problem-sitemaps  Validate only the 35 problematic state sitemaps')
    console.log('\nExamples:')
    console.log('  node validateSitemapFiles.js https://example.com/sitemap.xml')
    console.log('  node validateSitemapFiles.js --recursive https://example.com/sitemap.xml')
    console.log('  node validateSitemapFiles.js --goodparty')
    console.log('  node validateSitemapFiles.js --goodparty https://staging.goodparty.org')
    console.log('  node validateSitemapFiles.js --problem-sitemaps')
    process.exit(1)
  }

  // Parse options
  let recursive = false
  let goodparty = false
  let problemSitemaps = false
  let baseUrl = null
  const paths = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--recursive') {
      recursive = true
      console.log('Recursive mode enabled')
    } else if (args[i] === '--goodparty') {
      goodparty = true
      // Check if next argument is a URL
      if (i + 1 < args.length && args[i + 1].startsWith('http')) {
        baseUrl = args[i + 1]
        i++ // Skip the URL in next iteration
      }
    } else if (args[i] === '--problem-sitemaps') {
      problemSitemaps = true
      // Check if next argument is a URL
      if (i + 1 < args.length && args[i + 1].startsWith('http')) {
        baseUrl = args[i + 1]
        i++ // Skip the URL in next iteration
      }
    } else {
      paths.push(args[i])
    }
  }

  if (problemSitemaps) {
    validateGoodPartyProblemSitemaps(baseUrl).then(() => process.exit(0))
  } else if (goodparty) {
    validateGoodPartySitemaps(baseUrl).then(() => process.exit(0))
  } else {
    console.log(`Validating ${paths.length} sitemap(s) with recursive=${recursive}`)
    validateMultipleSitemaps(paths, { recursive }).then((results) => {
      // Print tree structure if recursive
      if (recursive && Object.keys(results).length > 0) {
        console.log('\n=== DETAILED RESULTS ===')
        SitemapValidator.printRecursiveResults(results)
      }
      process.exit(0)
    })
  }
}

export { SitemapValidator, validateMultipleSitemaps }