// scripts/sitemapHealthCheck.js
// Comprehensive health check for GoodParty sitemaps
// Checks for the specific issues mentioned in the SEO report

import fetch from 'node-fetch'
import { XMLParser } from 'fast-xml-parser'
import { fileURLToPath } from 'url'
import path from 'path'

class SitemapHealthCheck {
  constructor(baseUrl = 'https://goodparty.org') {
    this.baseUrl = baseUrl
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    })
    this.results = {
      totalUrls: 0,
      urlsByStatus: {},
      brokenSitemaps: [],
      emptySitemaps: [],
      urlsWithRedirects: [],
      urlsWith404s: [],
      duplicateUrls: new Set(),
      suspiciousUrls: [],
    }
  }

  /**
   * Run complete health check on all sitemaps
   */
  async runFullCheck() {
    console.log('Starting GoodParty Sitemap Health Check...\n')
    
    // Check main sitemap
    const mainSitemapUrl = `${this.baseUrl}/sitemap.xml`
    console.log(`Checking main sitemap: ${mainSitemapUrl}`)
    
    const mainSitemap = await this.fetchAndParseSitemap(mainSitemapUrl)
    if (!mainSitemap) {
      console.error('Failed to fetch main sitemap!')
      return this.results
    }

    // Process all sitemaps
    if (mainSitemap.sitemapindex) {
      await this.processSitemapIndex(mainSitemap.sitemapindex)
    } else if (mainSitemap.urlset) {
      await this.processUrlset(mainSitemapUrl, mainSitemap.urlset)
    }

    // Check state-specific sitemaps directly
    await this.checkStateSitemaps()

    // Generate report
    this.generateReport()
    
    return this.results
  }

  /**
   * Check all state sitemaps directly
   */
  async checkStateSitemaps() {
    console.log('\nChecking state-specific sitemaps...')
    
    const states = ['ak', 'al', 'ar', 'co', 'ct', 'dc', 'de', 'fl', 'ga', 'hi', 
                    'ia', 'id', 'il', 'in', 'ky', 'la', 'md', 'me', 'mn', 'mo',
                    'mt', 'nc', 'nd', 'nh', 'nj', 'nm', 'nv', 'oh', 'ri', 'sc',
                    'va', 'vt', 'wi', 'wv', 'wy']

    for (let i = 0; i < states.length; i++) {
      const state = states[i]
      
      // Check candidate sitemap
      const candidateUrl = `${this.baseUrl}/sitemaps/candidates/${state}/sitemap/${i}.xml`
      await this.checkSingleSitemap(candidateUrl, `candidates-${state}`)
      
      // Check election sitemap
      const electionUrl = `${this.baseUrl}/sitemaps/state/${state}/sitemap/${i}.xml`
      await this.checkSingleSitemap(electionUrl, `elections-${state}`)
    }
  }

  /**
   * Check a single sitemap
   */
  async checkSingleSitemap(url, identifier) {
    console.log(`  Checking ${identifier}...`)
    
    try {
      const response = await fetch(url, { 
        headers: { 'User-Agent': 'GoodParty-Sitemap-Validator/1.0' },
        timeout: 30000 
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          this.results.brokenSitemaps.push({
            url,
            error: '404 Not Found',
            identifier
          })
        } else {
          this.results.brokenSitemaps.push({
            url,
            error: `HTTP ${response.status}`,
            identifier
          })
        }
        return
      }

      const content = await response.text()
      
      // Check for empty content
      if (!content || content.trim().length === 0) {
        this.results.emptySitemaps.push({
          url,
          identifier
        })
        return
      }

      // Try to parse
      const parsed = this.parser.parse(content)
      
      if (parsed.urlset) {
        const urls = Array.isArray(parsed.urlset.url) 
          ? parsed.urlset.url 
          : (parsed.urlset.url ? [parsed.urlset.url] : [])
        
        if (urls.length === 0) {
          this.results.emptySitemaps.push({
            url,
            identifier,
            reason: 'No URLs in urlset'
          })
        } else {
          console.log(`    Found ${urls.length} URLs`)
          // Sample check first 10 URLs
          await this.sampleCheckUrls(urls.slice(0, 10), identifier)
        }
      }
    } catch (error) {
      this.results.brokenSitemaps.push({
        url,
        error: error.message,
        identifier
      })
    }
  }

  /**
   * Sample check URLs from a sitemap
   */
  async sampleCheckUrls(urls, sitemapIdentifier) {
    for (const url of urls) {
      const loc = url.loc?.['#text'] || url.loc
      if (!loc) continue

      // Check for suspicious patterns
      if (this.isSuspiciousUrl(loc)) {
        this.results.suspiciousUrls.push({
          url: loc,
          sitemap: sitemapIdentifier,
          reason: this.getSuspiciousReason(loc)
        })
      }

      // Track total URLs
      this.results.totalUrls++

      // Sample check URL status (limit to avoid overwhelming the server)
      if (Math.random() < 0.1) { // Check 10% of URLs
        await this.checkUrlStatus(loc)
      }
    }
  }

  /**
   * Check if URL matches suspicious patterns from the SEO report
   */
  isSuspiciousUrl(url) {
    // Check for malformed election URLs
    if (url.includes('/elections/position/') && url.includes('-(joint)')) {
      return true
    }
    
    // Check for double slashes
    if (url.includes('//') && !url.includes('://')) {
      return true
    }
    
    // Check for spaces or special characters
    if (url.includes(' ') || url.includes('%20')) {
      return true
    }
    
    return false
  }

  /**
   * Get reason why URL is suspicious
   */
  getSuspiciousReason(url) {
    if (url.includes('-(joint)')) return 'Malformed position name'
    if (url.includes('//')) return 'Double slashes in path'
    if (url.includes(' ') || url.includes('%20')) return 'Contains spaces'
    return 'Unknown pattern'
  }

  /**
   * Check URL status
   */
  async checkUrlStatus(url) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'GoodParty-Sitemap-Validator/1.0' },
        timeout: 10000,
        redirect: 'manual'
      })

      const status = response.status
      
      // Track by status
      this.results.urlsByStatus[status] = (this.results.urlsByStatus[status] || 0) + 1

      if (status === 404) {
        this.results.urlsWith404s.push(url)
      } else if (status >= 300 && status < 400) {
        this.results.urlsWithRedirects.push({
          url,
          status,
          location: response.headers.get('location')
        })
      }
    } catch (error) {
      // Network error
      this.results.urlsByStatus['error'] = (this.results.urlsByStatus['error'] || 0) + 1
    }
  }

  /**
   * Fetch and parse a sitemap
   */
  async fetchAndParseSitemap(url) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'GoodParty-Sitemap-Validator/1.0' }
      })
      
      if (!response.ok) {
        return null
      }

      const content = await response.text()
      return this.parser.parse(content)
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message)
      return null
    }
  }

  /**
   * Process sitemap index
   */
  async processSitemapIndex(sitemapindex) {
    const sitemaps = Array.isArray(sitemapindex.sitemap)
      ? sitemapindex.sitemap
      : (sitemapindex.sitemap ? [sitemapindex.sitemap] : [])

    for (const sitemap of sitemaps) {
      const loc = sitemap.loc?.['#text'] || sitemap.loc
      if (loc) {
        const parsed = await this.fetchAndParseSitemap(loc)
        if (parsed && parsed.urlset) {
          await this.processUrlset(loc, parsed.urlset)
        }
      }
    }
  }

  /**
   * Process URL set
   */
  async processUrlset(sitemapUrl, urlset) {
    const urls = Array.isArray(urlset.url)
      ? urlset.url
      : (urlset.url ? [urlset.url] : [])

    console.log(`Processing ${urls.length} URLs from ${sitemapUrl}`)
    
    for (const url of urls) {
      const loc = url.loc?.['#text'] || url.loc
      if (loc) {
        this.results.totalUrls++
        
        // Check for duplicates
        if (this.results.duplicateUrls.has(loc)) {
          console.log(`Duplicate URL found: ${loc}`)
        }
        this.results.duplicateUrls.add(loc)
      }
    }
  }

  /**
   * Generate final report
   */
  generateReport() {
    console.log('\n=== SITEMAP HEALTH CHECK REPORT ===\n')
    
    console.log('Overview:')
    console.log(`  Total URLs found: ${this.results.totalUrls}`)
    console.log(`  Unique URLs: ${this.results.duplicateUrls.size}`)
    console.log(`  Duplicate URLs: ${this.results.totalUrls - this.results.duplicateUrls.size}`)
    
    console.log('\nBroken Sitemaps:')
    if (this.results.brokenSitemaps.length === 0) {
      console.log('  None found')
    } else {
      this.results.brokenSitemaps.forEach(({ url, error, identifier }) => {
        console.log(`  ${identifier}: ${error}`)
        console.log(`    ${url}`)
      })
    }
    
    console.log('\nEmpty Sitemaps:')
    if (this.results.emptySitemaps.length === 0) {
      console.log('  None found')
    } else {
      this.results.emptySitemaps.forEach(({ identifier, reason }) => {
        console.log(`  ${identifier}${reason ? `: ${reason}` : ''}`)
      })
    }
    
    console.log('\nSuspicious URLs:')
    if (this.results.suspiciousUrls.length === 0) {
      console.log('  None found')
    } else {
      const byReason = {}
      this.results.suspiciousUrls.forEach(({ url, reason }) => {
        byReason[reason] = (byReason[reason] || 0) + 1
      })
      Object.entries(byReason).forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count} URLs`)
      })
    }
    
    console.log('\nURL Status Summary (from samples):')
    Object.entries(this.results.urlsByStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`)
    })
    
    console.log('\nRecommendations:')
    if (this.results.brokenSitemaps.length > 0) {
      console.log('  1. Fix broken sitemaps immediately')
    }
    if (this.results.emptySitemaps.length > 0) {
      console.log('  2. Remove or populate empty sitemaps')
    }
    if (this.results.suspiciousUrls.length > 0) {
      console.log('  3. Clean up URLs with suspicious patterns')
    }
    if (this.results.urlsWith404s.length > 0) {
      console.log('  4. Remove 404 URLs from sitemaps')
    }
    if (this.results.urlsWithRedirects.length > 0) {
      console.log('  5. Update redirected URLs to their final destinations')
    }
  }
}

// Run the health check when executed directly
const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const healthCheck = new SitemapHealthCheck()
  healthCheck.runFullCheck()
    .then(() => console.log('\nHealth check complete!'))
    .catch((error) => {
      console.error('Health check failed:', error)
      process.exitCode = 1
    })
}

export { SitemapHealthCheck }